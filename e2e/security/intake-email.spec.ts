// OWASP A01, A03, A04, A07 and A10 for the email channel (M10.5; brief §11; D-044; A-287 to A-293): the inbound-mail service posts
// each forwarded email with the source's key as the Basic password. Through the web app's /api proxy, as the service would.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";

async function channelId(api: APIRequestContext): Promise<string> {
  const response = await api.get("/api/v1/option-lists/leadChannels/options");
  const { items } = (await response.json()) as { items: { id: string; isOther: boolean }[] };
  return items.find((option) => !option.isOther)!.id;
}

async function register(admin: APIRequestContext, tag: string, kind: "EMAIL" | "WEBSITE") {
  const created = await admin.post("/api/v1/intake/sources", {
    data: { name: `${kind} ${tag}`, kind, channelId: await channelId(admin) },
  });
  expect(created.status()).toBe(201);
  return (await created.json()) as { source: { id: string }; key: string };
}

const basic = (key: string, user = "gymcrm") => `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`;
const email = (id: string, tag: string, patch: Record<string, unknown> = {}) => ({
  MessageID: id,
  FromFull: { Email: `sender.${tag.toLowerCase()}@example.com`, Name: `Khách ${tag}` },
  Subject: "Hỏi giá",
  TextBody: "Xin chào",
  Headers: [],
  ...patch,
});

test.describe("A07 the key as the Basic password", () => {
  test("only the source's own key gets in; a website key and the wrong kind are refused", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const mail = await register(admin, testTag, "EMAIL");
    const site = await register(admin, testTag, "WEBSITE");
    const service = await apiAs(null, { origin: null });
    const post = (authorization: string | null, data: unknown = email(`a.${testTag}`, testTag)) =>
      service.post("/api/v1/intake/email", { headers: authorization ? { authorization } : {}, data: data as never });

    expect((await post(basic(mail.key))).status()).toBe(200);
    // Any user name; only the password is the key.
    expect((await post(basic(mail.key, "someone-else"), email(`b.${testTag}`, testTag))).status()).toBe(200);
    for (const authorization of [basic("fci_wrong"), basic(`${mail.key}x`), basic(""), `Basic ${"!".repeat(10)}`]) {
      expect((await post(authorization)).status(), authorization).toBe(401);
    }
    // Not a source at all: no key and no Origin, so the Origin check refuses it.
    expect((await post(null)).status()).toBe(403);
    expect((await post(`Bearer ${mail.key}`)).status()).toBe(403);
    // A key of the other kind opens neither route.
    expect((await post(basic(site.key))).status()).toBe(403);
    const website = await service.post("/api/v1/intake/website", {
      headers: { authorization: basic(mail.key) },
      data: { externalId: "x", name: "x" },
    });
    expect(website.status()).toBe(403);
    // The key opens nothing else.
    const sources = await service.get("/api/v1/intake/sources", { headers: { authorization: basic(mail.key) } });
    expect(sources.status()).toBe(401);
  });

  test("a switched-off source and a replaced key are refused", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const mail = await register(admin, testTag, "EMAIL");
    const service = await apiAs(null, { origin: null });
    const post = (key: string, id: string) =>
      service.post("/api/v1/intake/email", { headers: { authorization: basic(key) }, data: email(id, testTag) });
    const rotated = (await (await admin.post(`/api/v1/intake/sources/${mail.source.id}/key`)).json()) as {
      key: string;
    };
    expect((await post(mail.key, `old.${testTag}`)).status()).toBe(401);
    expect((await post(rotated.key, `new.${testTag}`)).status()).toBe(200);
    await admin.patch(`/api/v1/intake/sources/${mail.source.id}`, {
      data: { name: `EMAIL ${testTag}`, active: false, channelId: await channelId(admin) },
    });
    expect((await post(rotated.key, `off.${testTag}`)).status()).toBe(401);
  });
});

test.describe("A03, A04 and A10 what an email may be", () => {
  test("attachments up to the limit are taken, a bigger body is refused, and only JSON is read", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const mail = await register(admin, testTag, "EMAIL");
    const service = await apiAs(null, { origin: null });
    const headers = { authorization: basic(mail.key) };
    const withFile = (id: string, size: number) =>
      email(id, testTag, {
        Attachments: [{ Name: "inbody.pdf", Content: "A".repeat(size), ContentType: "application/pdf" }],
      });

    const big = await service.post("/api/v1/intake/email", { headers, data: withFile(`big.${testTag}`, 3_000_000) });
    expect(big.status()).toBe(200);
    const huge = await service.post("/api/v1/intake/email", { headers, data: withFile(`huge.${testTag}`, 9_000_000) });
    // Over the route's 8 MB, and past the 10 MB the web app's proxy buffers: refused, as an oversize picture is (A-292).
    const past = await service.post("/api/v1/intake/email", { headers, data: withFile(`past.${testTag}`, 11_000_000) });
    for (const refused of [huge, past]) expect([400, 413]).toContain(refused.status());
    // Every other route keeps its small limit.
    const elsewhere = await admin.post("/api/v1/leads", { data: { fullName: "x".repeat(300_000) } });
    expect([400, 413]).toContain(elsewhere.status());
    // Only the email within the limit was taken in.
    const leads = (await (await admin.get(`/api/v1/leads?q=${encodeURIComponent(`Khách ${testTag}`)}`)).json()) as {
      items: { id: string }[];
    };
    const messages = (await (await admin.get(`/api/v1/persons/${leads.items[0]!.id}/messages`)).json()) as {
      items: unknown[];
    };
    expect(messages.items).toHaveLength(1);
    const text = await service.post("/api/v1/intake/email", {
      headers: { ...headers, "content-type": "text/plain" },
      data: "From: a@b.c",
    });
    expect(text.status()).toBe(415);
    expect((await service.post("/api/v1/intake/email", { headers, data: { hello: "world" } })).status()).toBe(400);
  });

  test("a script stays text, and an automatic email or the Gmail confirmation makes no lead", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const mail = await register(admin, testTag, "EMAIL");
    const service = await apiAs(null, { origin: null });
    const post = (data: unknown) =>
      service.post("/api/v1/intake/email", { headers: { authorization: basic(mail.key) }, data: data as never });

    const script = `<script>alert(1)</script> ${testTag}`;
    const sent = await post(email(`x.${testTag}`, testTag, { Subject: script }));
    expect(await sent.json()).toEqual({ received: 1, duplicates: 0 });
    const leads = (await (await admin.get(`/api/v1/leads?q=${encodeURIComponent(`Khách ${testTag}`)}`)).json()) as {
      items: { id: string }[];
    };
    const messages = (await (await admin.get(`/api/v1/persons/${leads.items[0]!.id}/messages`)).json()) as {
      items: { body: string }[];
    };
    expect(messages.items[0]!.body).toContain(script);

    for (const [index, patch] of [
      { Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }] },
      { FromFull: { Email: "mailer-daemon@googlemail.com" } },
      { FromFull: { Email: "forwarding-noreply@google.com" }, Subject: "Gmail Forwarding Confirmation" },
    ].entries()) {
      const answer = await post(email(`auto.${index}.${testTag}`, testTag, patch));
      expect(await answer.json()).toEqual({ received: 0, duplicates: 0 });
    }
  });
});
