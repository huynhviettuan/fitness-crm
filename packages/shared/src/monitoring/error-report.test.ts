import { describe, expect, it } from "vitest";
import { createErrorReporter, parseDsn, parseStack, scrubPath, scrubText } from "./error-report.js";

const DSN = "https://abc123@o42.ingest.sentry.io/4507";

/** A fetch that keeps what it was given and answers like Sentry. */
function recorder(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

function eventOf(body: unknown) {
  const [header, item, event] = String(body).split("\n");
  return { header: JSON.parse(header!), item: JSON.parse(item!), event: JSON.parse(event!) };
}

describe("the DSN (M9.4c, A-313)", () => {
  it("names the envelope endpoint and the key", () => {
    expect(parseDsn(DSN)).toEqual({
      endpoint: "https://o42.ingest.sentry.io/api/4507/envelope/",
      publicKey: "abc123",
      dsn: DSN,
    });
    expect(parseDsn("https://k@sentry.example.com/tools/12")?.endpoint).toBe(
      "https://sentry.example.com/tools/api/12/envelope/",
    );
  });

  it("is off when missing or not a DSN", () => {
    for (const value of [
      undefined,
      "",
      "not a url",
      "https://o42.ingest.sentry.io/4507",
      "https://k@host/project",
      "ftp://k@h/1",
    ]) {
      expect(parseDsn(value)).toBeNull();
    }
  });
});

describe("what leaves the system", () => {
  it("has no emails, phone or ID numbers, quoted values, or ids in the message", () => {
    const text = scrubText(
      'Unique constraint failed on phone "0912345678" for lan@example.com, customer 3f2a1b4c-1d2e-4f5a-8b9c-0d1e2f3a4b5c, CCCD 079123456789',
    );
    expect(text).not.toMatch(/0912345678|lan@example\.com|3f2a1b4c|079123456789/);
    expect(text).toContain("Unique constraint failed on phone");
  });

  it("has the path without query, ids or numbers", () => {
    expect(scrubPath("/api/v1/customers/3f2a1b4c-1d2e-4f5a-8b9c-0d1e2f3a4b5c/contracts?phone=0912345678")).toBe(
      "/api/v1/customers/:id/contracts",
    );
    expect(scrubPath("/intake/meta/123456789")).toBe("/intake/meta/:n");
  });

  it("reads V8's stack, oldest call first, telling the app from its packages", () => {
    const frames = parseStack(
      [
        "Error: boom",
        "    at createContract (file:///app/apps/api/dist/modules/contracts/contract.service.js:120:11)",
        "    at async Promise.all (index 0)",
        "    at /app/node_modules/.pnpm/@nestjs+core/router.js:38:29",
      ].join("\n"),
    );
    expect(frames).toEqual([
      { filename: "/app/node_modules/.pnpm/@nestjs+core/router.js", lineno: 38, colno: 29, in_app: false },
      {
        function: "createContract",
        filename: "/app/apps/api/dist/modules/contracts/contract.service.js",
        lineno: 120,
        colno: 11,
        in_app: true,
      },
    ]);
  });
});

describe("reporting an error", () => {
  it("sends one Sentry event with the service, route, release and causes, and nothing of the request", async () => {
    const { calls, fetcher } = recorder();
    const reporter = createErrorReporter({ dsn: DSN, release: "abc1234", environment: "production", fetch: fetcher });
    const error = new TypeError("Cannot read properties of undefined (reading 'id') for 0912345678", {
      cause: new Error("connection reset"),
    });

    expect(
      await reporter.report(error, { service: "api", method: "POST", path: "/api/v1/contracts?x=1", kind: "request" }),
    ).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect((calls[0]!.init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=abc123");
    const { header, item, event } = eventOf(calls[0]!.init.body);
    expect(header.event_id).toBe(event.event_id);
    expect(item).toEqual({ type: "event" });
    expect(event).toMatchObject({
      level: "error",
      environment: "production",
      release: "abc1234",
      transaction: "POST /api/v1/contracts",
      tags: { service: "api", kind: "request" },
      request: { method: "POST", url: "/api/v1/contracts" },
    });
    expect(event.exception.values.map((value: { type: string }) => value.type)).toEqual(["Error", "TypeError"]);
    expect(JSON.stringify(event)).not.toContain("0912345678");
    expect(Object.keys(event.request)).toEqual(["method", "url"]);
  });

  it("does nothing without a DSN", async () => {
    const { calls, fetcher } = recorder();
    const reporter = createErrorReporter({ dsn: undefined, release: null, environment: "development", fetch: fetcher });
    expect(reporter.enabled).toBe(false);
    expect(await reporter.report(new Error("x"), { service: "api" })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("cuts a burst to the limit per minute, then sends again", async () => {
    const { calls, fetcher } = recorder();
    let now = new Date("2026-10-15T10:00:00Z");
    const reporter = createErrorReporter({
      dsn: DSN,
      release: null,
      environment: "production",
      perMinute: 3,
      fetch: fetcher,
      now: () => now,
    });
    for (let index = 0; index < 10; index += 1) await reporter.report(new Error(`e${index}`), { service: "worker" });
    expect(calls).toHaveLength(3);
    now = new Date("2026-10-15T10:01:00Z");
    expect(await reporter.report(new Error("later"), { service: "worker" })).toBe(true);
  });

  it("never throws when Sentry is down or refuses", async () => {
    const failing = createErrorReporter({
      dsn: DSN,
      release: null,
      environment: "production",
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(await failing.report(new Error("x"), { service: "api" })).toBe(false);
    const refusing = createErrorReporter({
      dsn: DSN,
      release: null,
      environment: "production",
      fetch: recorder(429).fetcher,
    });
    expect(await refusing.report("a string", { service: "web", digest: "123" })).toBe(false);
  });
});
