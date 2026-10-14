// OWASP A01 (who may register a source), A02 (the secret is sealed and never returned), A03 (stored script, reflected
// challenge), A07 (the signature and the verify token), A08 (the exact bytes are signed), A09 (nothing secret comes back) and
// A10 (odd payloads) for WhatsApp as a lead channel (M10.2; brief §11; D-044; A-268 to A-274). The calls go through the web
// app's /api proxy, as Meta's would.
import { createHmac } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const SECRET = "SpecAppSecret0123456789abcdefABCDEF";
const ROLES: Role[] = ["FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];

async function channelId(api: APIRequestContext): Promise<string> {
  const response = await api.get("/api/v1/option-lists/leadChannels/options");
  const { items } = (await response.json()) as { items: { id: string; isOther: boolean }[] };
  const channel = items.find((option) => !option.isOther);
  if (!channel) throw new Error("No lead channel");
  return channel.id;
}

async function registerWhatsApp(admin: APIRequestContext, tag: string) {
  const created = await admin.post("/api/v1/intake/sources", {
    data: { name: `WhatsApp ${tag}`, kind: "WHATSAPP", channelId: await channelId(admin), appSecret: SECRET },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as {
    source: { id: string; webhookPath: string };
    key: string | null;
    verifyToken: string;
  };
  return { id: body.source.id, path: body.source.webhookPath, verifyToken: body.verifyToken, raw: body };
}

const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function delivery(tag: string, id: string, text = "Tôi muốn tập thử") {
  const phone = `849${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              contacts: [{ wa_id: phone, profile: { name: `Khách ${tag}` } }],
              messages: [
                {
                  from: phone,
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

const post = (meta: APIRequestContext, path: string, body: string, signature?: string) =>
  meta.post(path, {
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
    data: body,
  });

test.describe("A01 only Admin registers a WhatsApp source", () => {
  for (const role of ROLES) {
    test(`${role} registering one gets 403`, async ({ apiAs }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/intake/sources", {
        data: { name: "x", kind: "WHATSAPP", channelId: await channelId(api), appSecret: SECRET },
      });
      expect(response.status()).toBe(403);
    });
  }

  test("a source needs the app secret, and a website one refuses it", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const channel = await channelId(admin);
    const withName = `WhatsApp ${testTag}`;
    expect(
      (
        await admin.post("/api/v1/intake/sources", { data: { name: withName, kind: "WHATSAPP", channelId: channel } })
      ).status(),
    ).toBe(400);
    for (const appSecret of ["short", `${SECRET}!`, "a b".repeat(10), "x".repeat(201)]) {
      const response = await admin.post("/api/v1/intake/sources", {
        data: { name: withName, kind: "WHATSAPP", channelId: channel, appSecret },
      });
      expect(response.status(), appSecret).toBe(400);
    }
    expect(
      (
        await admin.post("/api/v1/intake/sources", {
          data: { name: withName, kind: "WEBSITE", channelId: channel, appSecret: SECRET },
        })
      ).status(),
    ).toBe(400);
  });
});

test.describe("A07 the handshake", () => {
  test("echoes the challenge for the verify token only; a script as challenge and every other attempt are 401", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    const meta = await apiAs(null, { origin: null });
    const ask = (query: string, path = source.path) => meta.get(`${path}?${query}`);

    const ok = await ask(
      `hub.mode=subscribe&hub.verify_token=${encodeURIComponent(source.verifyToken)}&hub.challenge=158772`,
    );
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe("158772");
    expect(ok.headers()["content-type"]).toContain("text/plain");

    const token = encodeURIComponent(source.verifyToken);
    for (const query of [
      "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
      `hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${encodeURIComponent("<script>alert(1)</script>")}`,
      `hub.mode=unsubscribe&hub.verify_token=${token}&hub.challenge=1`,
      `hub.verify_token=${token}&hub.challenge=1`,
      "",
    ]) {
      const response = await ask(query);
      expect(response.status(), query).toBe(401);
      expect(await response.text()).not.toContain("<script>");
    }
    const unknown = await ask(
      `hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1`,
      "/api/v1/intake/whatsapp/not-a-uuid",
    );
    expect(unknown.status()).toBe(401);
  });

  test("a new key gives a new verify token and the old one stops working", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    const rotated = (await (await admin.post(`/api/v1/intake/sources/${source.id}/key`)).json()) as {
      key: string | null;
      verifyToken: string;
    };
    expect(rotated.key).toBeNull();
    const meta = await apiAs(null, { origin: null });
    const handshake = (token: string) =>
      meta.get(`${source.path}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=7`);
    expect((await handshake(source.verifyToken)).status()).toBe(401);
    expect((await handshake(rotated.verifyToken)).status()).toBe(200);
  });
});

test.describe("A07 and A08 the signature", () => {
  test("a signed delivery is taken in without a session or an Origin, and the same message again is a repeat", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    const meta = await apiAs(null, { origin: null });
    const body = delivery(testTag, `wamid.${testTag}`);

    const first = await post(meta, source.path, body, sign(body));
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ received: 1, duplicates: 0 });
    const again = await post(meta, source.path, body, sign(body));
    expect(await again.json()).toEqual({ received: 0, duplicates: 1 });
  });

  test("a missing, wrong, other-secret, tampered or non-hex signature is 401 and keeps nothing", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    const meta = await apiAs(null, { origin: null });
    const body = delivery(testTag, `wamid.bad.${testTag}`);

    for (const signature of [
      `sha256=${"0".repeat(64)}`,
      sign(body, "AnotherSecret0123456789abcdefABCDEF"),
      sign(`${body} `),
      "sha256=zz",
      "garbage",
    ]) {
      expect((await post(meta, source.path, body, signature)).status(), signature).toBe(401);
    }
    // With no signature at all it is not Meta, and with no Origin either it is not a browser of the app: 403.
    expect((await post(meta, source.path, body)).status()).toBe(403);
    // A browser session of the app does not need a signature to be refused: the body is checked, not the cookie.
    expect((await post(admin, source.path, body)).status()).toBe(401);
    // Nothing was kept: the same message signed properly is the first.
    const accepted = await post(meta, source.path, body, sign(body));
    expect(await accepted.json()).toEqual({ received: 1, duplicates: 0 });
  });

  test("a delivery for another source, an unknown one or a switched-off one is 401", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const first = await registerWhatsApp(admin, `${testTag} a`);
    const second = await registerWhatsApp(admin, `${testTag} b`);
    const meta = await apiAs(null, { origin: null });
    const body = delivery(testTag, `wamid.cross.${testTag}`);
    // Both sources share the secret here, so prove the path decides: an unknown id and an off source are refused.
    expect(
      (await post(meta, "/api/v1/intake/whatsapp/00000000-0000-4000-8000-000000000000", body, sign(body))).status(),
    ).toBe(401);
    // A path that is not a source id is not even a webhook address, so the Origin check answers first.
    expect((await post(meta, "/api/v1/intake/whatsapp/not-a-uuid", body, sign(body))).status()).toBe(403);
    await admin.patch(`/api/v1/intake/sources/${second.id}`, {
      data: { name: `WhatsApp ${testTag} b`, active: false, channelId: await channelId(admin) },
    });
    expect((await post(meta, second.path, body, sign(body))).status()).toBe(401);
    expect((await post(meta, first.path, body, sign(body))).status()).toBe(200);
  });

  test("a website key is not a way into the WhatsApp route, and the signature is no way into the website one", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    const meta = await apiAs(null, { origin: null });
    const body = delivery(testTag, `wamid.route.${testTag}`);
    const response = await meta.post(source.path, {
      headers: { "content-type": "application/json", "x-intake-key": `fci_${"a".repeat(43)}` },
      data: body,
    });
    expect(response.status()).toBe(403);
    const website = await meta.post("/api/v1/intake/website", {
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) },
      data: body,
    });
    expect(website.status()).toBe(403);
  });
});

test.describe("A02, A03, A09 and A10 what is stored, returned and read", () => {
  test("the app secret and the verify token never come back, and a script stays text", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    expect(source.raw.key).toBeNull();
    const meta = await apiAs(null, { origin: null });
    const script = `<script>alert(1)</script> ${testTag}`;
    const body = delivery(testTag, `wamid.xss.${testTag}`, script);
    const accepted = await post(meta, source.path, body, sign(body));
    const list = await admin.get("/api/v1/intake/sources");
    for (const response of [list, accepted]) {
      const text = await response.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(source.verifyToken);
      expect(text).not.toMatch(/secretEnc|secret_enc|verifyTokenHash|verify_token_hash/);
    }
    const rotated = await admin.patch(`/api/v1/intake/sources/${source.id}`, {
      data: { name: `WhatsApp ${testTag}`, active: true, channelId: await channelId(admin) },
    });
    expect(await rotated.text()).not.toContain(SECRET);
  });

  test("payloads that are signed but not messages are answered 200 with nothing taken in; bad JSON is 400", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await registerWhatsApp(admin, testTag);
    const meta = await apiAs(null, { origin: null });
    for (const body of [
      "{}",
      "[]",
      '{"entry":"x"}',
      '{"entry":[{"changes":[{"value":{"statuses":[{"id":"x","status":"read"}]}}]}]}',
      '{"entry":[{"changes":[{"value":{"messages":[{"type":"text"}]}}]}]}',
    ]) {
      const response = await post(meta, source.path, body, sign(body));
      expect(response.status(), body).toBe(200);
      expect(await response.json(), body).toEqual({ received: 0, duplicates: 0 });
    }
    const broken = "{not json";
    expect((await post(meta, source.path, broken, sign(broken))).status()).toBe(400);
    const notJson = await meta.post(source.path, {
      headers: { "content-type": "text/plain", "x-hub-signature-256": sign("a=1") },
      data: "a=1",
    });
    expect(notJson.status()).toBe(415);
  });
});
