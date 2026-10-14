// OWASP A01, A02, A03, A07, A08 and A09 for Messenger and Instagram as lead channels (M10.3; brief §11; D-044; A-275 to A-280).
// The same proof as WhatsApp (e2e/security/intake-whatsapp.spec.ts), at the shared Meta address; these cases check what differs:
// the address serves only its kinds, the sender id is the thread, and our own echoes are never taken for a customer.
import { createHmac, randomInt } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const SECRET = "SpecMessagingSecret0123456789abcdef";

async function channelId(api: APIRequestContext): Promise<string> {
  const response = await api.get("/api/v1/option-lists/leadChannels/options");
  const { items } = (await response.json()) as { items: { id: string; isOther: boolean }[] };
  const channel = items.find((option) => !option.isOther);
  if (!channel) throw new Error("No lead channel");
  return channel.id;
}

async function register(admin: APIRequestContext, tag: string, kind: "MESSENGER" | "INSTAGRAM" | "WHATSAPP") {
  const created = await admin.post("/api/v1/intake/sources", {
    data: { name: `${kind} ${tag}`, kind, channelId: await channelId(admin), appSecret: SECRET },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { source: { id: string; webhookPath: string }; verifyToken: string };
  return { id: body.source.id, path: body.source.webhookPath, verifyToken: body.verifyToken };
}

const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const sender = () => String(1_000_000_000_000_000 + randomInt(1_000_000_000));

function delivery(object: "page" | "instagram", events: unknown[]) {
  return JSON.stringify({ object, entry: [{ id: "PAGE", time: Date.now(), messaging: events }] });
}
const text = (from: string, mid: string, body: string) => ({
  sender: { id: from },
  recipient: { id: "PAGE" },
  timestamp: Date.now(),
  message: { mid, text: body },
});

const post = (meta: APIRequestContext, path: string, body: string, signature?: string) =>
  meta.post(path, {
    headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
    data: body,
  });

test.describe("A01 only Admin registers a Messenger or Instagram source", () => {
  for (const role of ["FITNESS_MANAGER", "CONSULTING", "RECEPTIONIST"] as Role[]) {
    test(`${role} registering one gets 403`, async ({ apiAs }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/intake/sources", {
        data: { name: "x", kind: "MESSENGER", channelId: await channelId(api), appSecret: SECRET },
      });
      expect(response.status()).toBe(403);
    });
  }

  test("the app secret is required, sealed, and never returned", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const missing = await admin.post("/api/v1/intake/sources", {
      data: { name: `MESSENGER ${testTag}`, kind: "INSTAGRAM", channelId: await channelId(admin) },
    });
    expect(missing.status()).toBe(400);
    const source = await register(admin, testTag, "INSTAGRAM");
    expect(source.path).toBe(`/api/v1/intake/meta/${source.id}`);
    const list = await (await admin.get("/api/v1/intake/sources")).text();
    expect(list).not.toContain(SECRET);
    expect(list).not.toContain(source.verifyToken);
  });
});

test.describe("A07 and A08 the shared Meta address", () => {
  test("serves only Messenger and Instagram sources, and WhatsApp's address only WhatsApp's", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const messenger = await register(admin, testTag, "MESSENGER");
    const whatsapp = await register(admin, testTag, "WHATSAPP");
    const meta = await apiAs(null, { origin: null });
    const handshake = (path: string, token: string) =>
      meta.get(`${path}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=9`);

    expect(await (await handshake(messenger.path, messenger.verifyToken)).text()).toBe("9");
    // The source's id at the other address is not that source.
    expect((await handshake(`/api/v1/intake/whatsapp/${messenger.id}`, messenger.verifyToken)).status()).toBe(401);
    expect((await handshake(`/api/v1/intake/meta/${whatsapp.id}`, whatsapp.verifyToken)).status()).toBe(401);
    const body = delivery("page", [text(sender(), `m.${testTag}`, "Xin chào")]);
    expect((await post(meta, `/api/v1/intake/meta/${whatsapp.id}`, body, sign(body))).status()).toBe(401);
    expect((await post(meta, `/api/v1/intake/whatsapp/${messenger.id}`, body, sign(body))).status()).toBe(401);
  });

  test("a wrong, tampered or missing signature is refused and keeps nothing", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const source = await register(admin, testTag, "MESSENGER");
    const meta = await apiAs(null, { origin: null });
    const body = delivery("page", [text(sender(), `m.bad.${testTag}`, "Xin chào")]);
    for (const signature of [
      `sha256=${"0".repeat(64)}`,
      sign(body, "OtherSecret0123456789abcdefABCDEF"),
      sign(`${body} `),
    ]) {
      expect((await post(meta, source.path, body, signature)).status()).toBe(401);
    }
    expect((await post(meta, source.path, body)).status()).toBe(403);
    expect(await (await post(meta, source.path, body, sign(body))).json()).toEqual({ received: 1, duplicates: 0 });
  });
});

test.describe("A01 and A03 what a sender can and cannot do", () => {
  test("our own echoes are never a customer, and the other product's body is not read", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const source = await register(admin, testTag, "MESSENGER");
    const meta = await apiAs(null, { origin: null });
    const echo = { sender: { id: "PAGE" }, message: { mid: `echo.${testTag}`, text: "Chào bạn", is_echo: true } };
    for (const body of [delivery("page", [echo]), delivery("instagram", [text(sender(), `ig.${testTag}`, "Hi")])]) {
      expect(await (await post(meta, source.path, body, sign(body))).json()).toEqual({ received: 0, duplicates: 0 });
    }
  });

  test("a sender cannot write into another person's conversation, and a script stays text", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const source = await register(admin, testTag, "MESSENGER");
    const meta = await apiAs(null, { origin: null });
    const [first, second] = [sender(), sender()];
    const script = `<script>alert(1)</script> ${testTag}`;
    for (const [from, mid, words] of [
      [first, `a.${testTag}`, script],
      [second, `b.${testTag}`, "Khác"],
    ] as const) {
      const body = delivery("page", [text(from, mid, words)]);
      expect((await post(meta, source.path, body, sign(body))).status()).toBe(200);
    }
    const leads = await admin.get(`/api/v1/leads?q=${encodeURIComponent(`Messenger ${first.slice(-6)}`)}`);
    const { items } = (await leads.json()) as { items: { id: string }[] };
    expect(items).toHaveLength(1);
    const messages = (await (await admin.get(`/api/v1/persons/${items[0]!.id}/messages`)).json()) as {
      items: { body: string }[];
    };
    expect(messages.items.map((message) => message.body)).toEqual([script]);
  });
});
