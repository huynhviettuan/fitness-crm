// OWASP A01 (access control), A03 (stored script), A04 (flooding), A07 (the key), A09 (the key is never returned again) and A10
// (input errors) for the lead intake gateway (M10.1; brief §11; D-044; A-261 to A-267).
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { otherOptionId } from "../support/options";
import type { Role } from "../support/db";

const KEY_SHAPE = /^fci_[A-Za-z0-9_-]{40,}$/;
const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];

async function channelId(api: APIRequestContext): Promise<string> {
  const response = await api.get("/api/v1/option-lists/leadChannels/options");
  const { items } = (await response.json()) as { items: { id: string; isOther: boolean }[] };
  const channel = items.find((option) => !option.isOther);
  if (!channel) throw new Error("No lead channel");
  return channel.id;
}

async function registerSource(admin: APIRequestContext, tag: string) {
  const created = await admin.post("/api/v1/intake/sources", {
    data: { name: `Website ${tag}`, kind: "WEBSITE", channelId: await channelId(admin) },
  });
  expect(created.status()).toBe(201);
  return (await created.json()) as { source: { id: string }; key: string };
}

test.describe("A01 only Admin handles the sources", () => {
  for (const role of ROLES) {
    const status = role === "ADMIN" ? 200 : 403;
    test(`${role} listing the sources gets ${status}`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/intake/sources")).status()).toBe(status);
    });
  }

  test("a role other than Admin cannot register, change or re-key a source", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { source } = await registerSource(admin, testTag);
    const channel = await channelId(admin);
    for (const role of ROLES.filter((candidate) => candidate !== "ADMIN")) {
      const api = await apiAs(role);
      expect(
        (
          await api.post("/api/v1/intake/sources", { data: { name: "x", kind: "WEBSITE", channelId: channel } })
        ).status(),
        role,
      ).toBe(403);
      expect(
        (
          await api.patch(`/api/v1/intake/sources/${source.id}`, {
            data: { name: "x", active: false, channelId: channel },
          })
        ).status(),
        role,
      ).toBe(403);
      expect((await api.post(`/api/v1/intake/sources/${source.id}/key`)).status(), role).toBe(403);
    }
  });

  test("an anonymous request to the admin routes is 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/intake/sources")).status()).toBe(401);
    expect((await anonymous.get("/api/v1/persons/3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11/messages")).status()).toBe(401);
  });
});

test.describe("A07 a source proves itself with its key, and nothing else gets in", () => {
  test("no key, a wrong key, a malformed key, a switched-off source and a replaced key are all refused", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { source, key } = await registerSource(admin, testTag);
    expect(key).toMatch(KEY_SHAPE);
    const sender = await apiAs(null, { origin: null });
    const send = (headers: Record<string, string>, id = `ext-${testTag}`) =>
      sender.post("/api/v1/intake/website", { headers, data: { externalId: id, name: `Khách ${testTag}` } });

    expect((await send({ "x-intake-key": key })).status()).toBe(200);
    // With no key at all it is not a source, and with no Origin either it is not a browser of the app: 403.
    expect((await send({})).status()).toBe(403);
    for (const headers of [{ "x-intake-key": "" }, { "x-intake-key": "fci_wrong" }, { "x-intake-key": `${key}x` }]) {
      const response = await send(headers);
      expect(response.status(), JSON.stringify(headers)).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    }
    // A machine's key is not a source's.
    expect((await send({ "x-intake-key": `fcd_${"a".repeat(43)}` })).status()).toBe(401);

    await admin.patch(`/api/v1/intake/sources/${source.id}`, {
      data: { name: `Website ${testTag}`, active: false, channelId: await channelId(admin) },
    });
    expect((await send({ "x-intake-key": key })).status()).toBe(401);
    await admin.patch(`/api/v1/intake/sources/${source.id}`, {
      data: { name: `Website ${testTag}`, active: true, channelId: await channelId(admin) },
    });
    const rotated = (await (await admin.post(`/api/v1/intake/sources/${source.id}/key`)).json()) as { key: string };
    expect((await send({ "x-intake-key": key })).status()).toBe(401);
    expect((await send({ "x-intake-key": rotated.key })).status()).toBe(200);
  });

  test("a signed-in user is not a source, and the key opens no other route", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { key } = await registerSource(admin, testTag);
    // A browser session without the key is refused by the source route's guard.
    expect(
      (await admin.post("/api/v1/intake/website", { data: { externalId: "x", name: `Khách ${testTag}` } })).status(),
    ).toBe(401);
    // The key is for the website route only: a state change elsewhere still needs a session and the app's Origin.
    const sender = await apiAs(null, { origin: null });
    expect(
      (await sender.post("/api/v1/leads", { headers: { "x-intake-key": key }, data: { fullName: "x" } })).status(),
    ).toBe(403);
    expect((await sender.get("/api/v1/intake/sources", { headers: { "x-intake-key": key } })).status()).toBe(401);
    // A browser from another site cannot use it either: it sends a foreign Origin and no key.
    const foreign = await apiAs(null, { origin: "https://evil.example" });
    expect((await foreign.post("/api/v1/intake/website", { data: { externalId: "x", name: "x" } })).status()).toBe(403);
  });

  test("the key is shown once and never comes back in a list, a read, an update or a message", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { source, key } = await registerSource(admin, testTag);
    const sender = await apiAs(null, { origin: null });
    const answer = await sender.post("/api/v1/intake/website", {
      headers: { "x-intake-key": key },
      data: { externalId: "once", name: `Khách ${testTag}` },
    });
    const { personId } = (await answer.json()) as { personId: string };
    const channel = await channelId(admin);
    const responses = [
      await admin.get("/api/v1/intake/sources"),
      await admin.patch(`/api/v1/intake/sources/${source.id}`, {
        data: { name: `Website ${testTag}`, active: true, channelId: channel },
      }),
      await admin.get(`/api/v1/persons/${personId}/messages`),
      answer,
    ];
    for (const response of responses) {
      const body = await response.text();
      expect(body).not.toContain(key);
      expect(body).not.toMatch(/keyHash|key_hash/);
    }
  });
});

test.describe("A03 and A10 the submission", () => {
  test("a script stays text; bad input is a 400; a body that is not JSON is refused", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { key } = await registerSource(admin, testTag);
    const sender = await apiAs(null, { origin: null });
    const send = (data: unknown, headers: Record<string, string> = {}) =>
      sender.post("/api/v1/intake/website", { headers: { "x-intake-key": key, ...headers }, data: data as never });

    const script = `<script>alert(1)</script> ${testTag}`;
    const stored = await send({ externalId: "s1", name: script, message: script });
    expect(stored.status()).toBe(200);
    const { personId } = (await stored.json()) as { personId: string };
    const messages = (await (await admin.get(`/api/v1/persons/${personId}/messages`)).json()) as {
      items: { body: string }[];
    };
    expect(messages.items[0]!.body).toBe(script);

    for (const data of [
      {},
      { externalId: "e" },
      { name: "An" },
      { externalId: "e", name: "An", phone: "abc" },
      { externalId: "e", name: "An", email: "nope" },
      { externalId: "e", name: "a\u0007b" },
      { externalId: "e", name: "An", message: "x".repeat(4001) },
      { externalId: "e", name: "An", channelId: "elsewhere" },
      { externalId: "e".repeat(201), name: "An" },
    ]) {
      expect((await send(data)).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    const notJson = await sender.post("/api/v1/intake/website", {
      headers: { "x-intake-key": key, "content-type": "text/plain" },
      data: "externalId=1&name=An",
    });
    expect(notJson.status()).toBe(415);
  });

  test("the same submission twice is one lead, and a flood is answered with 429", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { key } = await registerSource(admin, testTag);
    const sender = await apiAs(null, { origin: null });
    const send = (id: string) =>
      sender.post("/api/v1/intake/website", {
        headers: { "x-intake-key": key },
        data: { externalId: id, name: `Khách ${testTag}` },
      });
    const first = (await (await send("same")).json()) as { personId: string; duplicate: boolean };
    const again = (await (await send("same")).json()) as { personId: string; duplicate: boolean };
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ personId: first.personId, duplicate: true });

    let refused = 0;
    for (let index = 0; index < 70; index += 1) {
      if ((await send(`flood-${index}`)).status() === 429) refused += 1;
    }
    expect(refused).toBeGreaterThan(0);
  });

  test("the conversation of a person is for those who may see the lead", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { key } = await registerSource(admin, testTag);
    const sender = await apiAs(null, { origin: null });
    const answer = await sender.post("/api/v1/intake/website", {
      headers: { "x-intake-key": key },
      data: { externalId: "c1", name: `Khách ${testTag}`, message: "Xin chào" },
    });
    const { personId } = (await answer.json()) as { personId: string };
    for (const role of ["PT", "ACCOUNTANT"] as Role[]) {
      expect((await (await apiAs(role)).get(`/api/v1/persons/${personId}/messages`)).status(), role).toBe(403);
    }
    expect((await admin.get(`/api/v1/persons/${personId}/messages`)).status()).toBe(200);
    expect((await admin.get("/api/v1/persons/not-a-uuid/messages")).status()).toBe(404);
    // An unused import guard: the Other option of a list exists for the lists that have one.
    expect(await otherOptionId(admin, "leadChannels")).toBeTruthy();
  });
});
