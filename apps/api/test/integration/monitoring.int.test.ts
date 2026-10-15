import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { ArgumentsHost } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createErrorReporter } from "@flow/shared/monitoring";
import { AppError } from "../../src/platform/errors/app-error.js";
import { ErrorFilter } from "../../src/platform/http/error.filter.js";

// M9.4c (A-313): an unexpected error answers 500 in the error contract and is reported to Sentry, over HTTP, with nothing
// of the request but its method and scrubbed path. A stand-in for Sentry receives the envelope.
let server: Server;
const received: { url: string; auth: string; body: string }[] = [];
let dsn = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      received.push({ url: request.url ?? "", auth: String(request.headers["x-sentry-auth"] ?? ""), body });
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  dsn = `http://publickey@127.0.0.1:${(server.address() as AddressInfo).port}/7`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function httpHost(request: Record<string, unknown>) {
  const answer: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      answer.status = code;
      return this;
    },
    json(body: unknown) {
      answer.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, answer };
}

const REQUEST = {
  method: "POST",
  originalUrl: "/api/v1/customers/3f2a1b4c-1d2e-4f5a-8b9c-0d1e2f3a4b5c/notes?phone=0912345678",
  headers: { cookie: "better-auth.session_token=secret-session", "x-device-key": "fcd_secret" },
  body: { note: "Khách đau lưng, SĐT 0987654321" },
};

describe("error monitoring (A-313)", () => {
  it("answers 500 and reports the error with its route, never the request's data", async () => {
    received.length = 0;
    const filter = new ErrorFilter();
    filter.reporter = createErrorReporter({ dsn, release: "test-release", environment: "test" });
    const { host, answer } = httpHost(REQUEST);

    filter.catch(new Error("insert failed for lan@example.com"), host);
    expect(answer).toMatchObject({ status: 500, body: { code: "INTERNAL_ERROR" } });
    await expect.poll(() => received.length).toBe(1);

    expect(received[0]!.url).toBe("/api/7/envelope/");
    expect(received[0]!.auth).toContain("sentry_key=publickey");
    const event = JSON.parse(received[0]!.body.split("\n")[2]!);
    expect(event).toMatchObject({
      release: "test-release",
      environment: "test",
      transaction: "POST /api/v1/customers/:id/notes",
      tags: { service: "api", kind: "request" },
    });
    for (const secret of ["secret-session", "fcd_secret", "0987654321", "0912345678", "lan@example.com", "3f2a1b4c"]) {
      expect(received[0]!.body).not.toContain(secret);
    }
  });

  it("does not report the errors the API means to answer (a refusal, a missing record)", async () => {
    received.length = 0;
    const filter = new ErrorFilter();
    filter.reporter = createErrorReporter({ dsn, release: null, environment: "test" });
    for (const error of [new AppError("FORBIDDEN"), new AppError("NOT_FOUND"), new AppError("VALIDATION_FAILED")]) {
      filter.catch(error, httpHost(REQUEST).host);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toHaveLength(0);
  });

  it("answers 500 the same when Sentry cannot be reached", async () => {
    const filter = new ErrorFilter();
    filter.reporter = createErrorReporter({ dsn: "http://k@127.0.0.1:9/1", release: null, environment: "test" });
    const { host, answer } = httpHost(REQUEST);
    filter.catch(new Error("boom"), host);
    expect(answer).toMatchObject({ status: 500, body: { code: "INTERNAL_ERROR" } });
  });
});
