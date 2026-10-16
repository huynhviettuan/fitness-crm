// OWASP A01, A02, A03, A07, A08 and A10 for Zalo OA as a lead channel, receive only (M10.6; brief §11; D-036, D-044; A-294 to
// A-300). Zalo signs each event with mac = sha256(appId + body + timestamp + OA secret key); through the web app's /api proxy.
import { createHash, randomInt } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const SECRET = "SpecZaloOaSecretKey0123456789";
const APP_ID = "360846524940903967";

async function channelId(api: APIRequestContext): Promise<string> {
  const response = await api.get("/api/v1/option-lists/leadChannels/options");
  const { items } = (await response.json()) as { items: { id: string; isOther: boolean }[] };
  return items.find((option) => !option.isOther)!.id;
}

async function register(admin: APIRequestContext, tag: string) {
  const created = await admin.post("/api/v1/intake/sources", {
    data: { name: `Zalo ${tag}`, kind: "ZALO", channelId: await channelId(admin), appSecret: SECRET, appId: APP_ID },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { source: { id: string; webhookPath: string }; key: null; verifyToken: null };
  return { id: body.source.id, path: body.source.webhookPath, raw: body };
}

const mac = (body: string, timestamp: string, appId = APP_ID, secret = SECRET) =>
  createHash("sha256").update(appId).update(body).update(timestamp).update(secret).digest("hex");

function event(tag: string, msgId: string, words: string, appId = APP_ID) {
  const timestamp = String(Date.now());
  const body = JSON.stringify({
    app_id: appId,
    sender: { id: String(1_000_000_000_000_000 + randomInt(1_000_000_000)) },
    recipient: { id: "388613280878808645" },
    event_name: "user_send_text",
    message: { text: words, msg_id: `${msgId}.${tag}` },
    timestamp,
  });
  return { body, timestamp };
}

const post = (zalo: APIRequestContext, path: string, body: string, signature?: string) =>
  zalo.post(path, {
    headers: { "content-type": "application/json", ...(signature ? { "x-zevent-signature": signature } : {}) },
    data: body,
  });

test.describe("A01 and A02 only Admin registers a Zalo source, and its secret never comes back", () => {
  for (const role of ["FITNESS_MANAGER", "CONSULTING", "RECEPTIONIST"] as Role[]) {
    test(`${role} registering one gets 403`, async ({ apiAs }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/intake/sources", {
        data: { name: "x", kind: "ZALO", channelId: await channelId(api), appSecret: SECRET, appId: APP_ID },
      });
      expect(response.status()).toBe(403);
    });
  }

  test("it needs the app id and the secret, and neither key nor secret is ever returned", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const channel = await channelId(admin);
    for (const data of [
      { appSecret: SECRET },
      { appId: APP_ID },
      { appSecret: SECRET, appId: "not-digits" },
      { appSecret: "short", appId: APP_ID },
    ]) {
      const response = await admin.post("/api/v1/intake/sources", {
        data: { name: `Zalo ${testTag}`, kind: "ZALO", channelId: channel, ...data },
      });
      expect(response.status(), JSON.stringify(data)).toBe(400);
    }
    const source = await register(admin, testTag);
    expect(source.raw).toMatchObject({ key: null, verifyToken: null });
    expect((await admin.post(`/api/v1/intake/sources/${source.id}/key`)).status()).toBe(400);
    const list = await (await admin.get("/api/v1/intake/sources")).text();
    expect(list).not.toContain(SECRET);
    expect(list).not.toMatch(/secretEnc|secret_enc/);
  });
});

test.describe("A07 and A08 the signature", () => {
  test("a signed event is taken in once without a session or an Origin; mac= and the bare hex both work", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await register(admin, testTag);
    const zalo = await apiAs(null, { origin: null });
    const first = event(testTag, "m1", "Xin chào");
    expect(await (await post(zalo, source.path, first.body, `mac=${mac(first.body, first.timestamp)}`)).json()).toEqual(
      {
        received: 1,
        duplicates: 0,
      },
    );
    expect(await (await post(zalo, source.path, first.body, mac(first.body, first.timestamp))).json()).toEqual({
      received: 0,
      duplicates: 1,
    });
  });

  test("a wrong secret, another app, a tampered body, a bad or missing signature are refused", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await register(admin, testTag);
    const zalo = await apiAs(null, { origin: null });
    const one = event(testTag, "bad", "Xin chào");
    const other = event(testTag, "other", "Xin chào", "999999999999");
    for (const [body, signature] of [
      [one.body, `mac=${mac(one.body, one.timestamp, APP_ID, "AnotherSecretKey0123456789ab")}`],
      [other.body, `mac=${mac(other.body, other.timestamp, "999999999999")}`],
      [`${one.body} `, `mac=${mac(one.body, one.timestamp)}`],
      [one.body, `mac=${"0".repeat(64)}`],
      [one.body, "mac=xyz"],
    ] as const) {
      expect((await post(zalo, source.path, body, signature)).status(), signature.slice(0, 20)).toBe(401);
    }
    // No signature and no Origin: not Zalo, not a browser of the app.
    expect((await post(zalo, source.path, one.body)).status()).toBe(403);
    // Another kind's signature header is not Zalo's.
    const meta = await zalo.post(source.path, {
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
      data: one.body,
    });
    expect(meta.status()).toBe(401);
    // The signed event for an unknown source.
    const unknown = `/api/v1/intake/zalo/00000000-0000-4000-8000-000000000000`;
    expect((await post(zalo, unknown, one.body, `mac=${mac(one.body, one.timestamp)}`)).status()).toBe(401);
    // Nothing of the refused events was kept: the good one is the first.
    expect(await (await post(zalo, source.path, one.body, `mac=${mac(one.body, one.timestamp)}`)).json()).toEqual({
      received: 1,
      duplicates: 0,
    });
  });
});

test.describe("A03 and A10 what an event may be", () => {
  test("a script stays text, other events are answered with nothing taken in, and bad JSON is refused", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await register(admin, testTag);
    const zalo = await apiAs(null, { origin: null });
    const script = `<script>alert(1)</script> ${testTag}`;
    const xss = event(testTag, "xss", script);
    expect((await post(zalo, source.path, xss.body, `mac=${mac(xss.body, xss.timestamp)}`)).status()).toBe(200);
    const userId = (JSON.parse(xss.body) as { sender: { id: string } }).sender.id;
    const leads = (await (
      await admin.get(`/api/v1/leads?q=${encodeURIComponent(`Zalo ${userId.slice(-6)}`)}`)
    ).json()) as {
      items: { id: string }[];
    };
    const messages = (await (await admin.get(`/api/v1/persons/${leads.items[0]!.id}/messages`)).json()) as {
      items: { body: string }[];
    };
    expect(messages.items[0]!.body).toBe(script);

    const timestamp = String(Date.now());
    const follow = JSON.stringify({ app_id: APP_ID, event_name: "follow", follower: { id: "1" }, timestamp });
    expect(await (await post(zalo, source.path, follow, `mac=${mac(follow, timestamp)}`)).json()).toEqual({
      received: 0,
      duplicates: 0,
    });
    expect((await post(zalo, source.path, "{nope", `mac=${mac("{nope", "")}`)).status()).toBe(400);
  });
});
