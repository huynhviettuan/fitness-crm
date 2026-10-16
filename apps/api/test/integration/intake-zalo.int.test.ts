import { afterEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_WINDOW_MS,
  createSource,
  listMessages,
  receiveZalo,
  rotateSourceKey,
  updateSource,
  zaloSignature,
} from "../../src/modules/intake/intake.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import type { AppError } from "../../src/platform/errors/app-error.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";
import { newLead } from "../support/leads.js";

afterEach(resetDatabase);

// Zalo OA, receive only (M10.6; brief §11; D-036, D-044, D-019; A-294 to A-300), against events signed as developers.zalo.me
// describes: mac = sha256(appId + data + timeStamp + OAsecretKey).

const SECRET = "ZaloOaSecretKey0123456789abcd";
const APP_ID = "360846524940903967";
const USER = "246845883529197922";

async function world() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  await createTestUser("CONSULTING", { allBranches: true });
  const channelId = await optionId("leadChannels", "WhatsApp");
  const created = await createSource(admin, {
    name: "Zalo OA",
    kind: "ZALO",
    channelId,
    appSecret: SECRET,
    appId: APP_ID,
  });
  return { admin, channelId, created, source: created.source };
}
type World = Awaited<ReturnType<typeof world>>;

const text = (msgId: string, words = "Cho mình hỏi giá PT", user = USER) => ({
  app_id: APP_ID,
  sender: { id: user },
  recipient: { id: "388613280878808645" },
  event_name: "user_send_text",
  message: { text: words, msg_id: msgId },
  timestamp: String(Date.now()),
});
const info = (phone: string, user = USER) => ({
  app_id: APP_ID,
  sender: { id: user },
  recipient: { id: "388613280878808645" },
  event_name: "user_submit_info",
  timestamp: String(Date.now()),
  info: { name: "Trần Thị Bình", phone },
});

/** Posts an event the way Zalo does: the body as bytes, signed with the app id, the body, its timestamp and the secret. */
function deliver(
  w: World,
  body: { timestamp: string } & Record<string, unknown>,
  options: { secret?: string; appId?: string; header?: string } = {},
) {
  const raw = Buffer.from(JSON.stringify(body));
  const mac = zaloSignature(options.appId ?? APP_ID, raw, body.timestamp, options.secret ?? SECRET);
  return receiveZalo(w.source.id, raw, options.header ?? `mac=${mac}`, body);
}
const failure = async (promise: Promise<unknown>) =>
  (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as AppError | null;

describe("a Zalo source (A-294)", () => {
  it("keeps the OA secret key sealed and the app id, has no key or token, and its own address", async () => {
    const w = await world();
    expect(w.created).toMatchObject({ key: null, verifyToken: null });
    expect(w.source.webhookPath).toBe(`/api/v1/intake/zalo/${w.source.id}`);
    const row = await prisma.intakeSource.findUniqueOrThrow({ where: { id: w.source.id } });
    expect(row).toMatchObject({ kind: "ZALO", keyHash: null, verifyTokenHash: null, appRef: APP_ID });
    expect(row.secretEnc).not.toContain(SECRET);
    await expect(rotateSourceKey(w.admin, w.source.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("needs the OA secret key and the app id", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const channelId = await optionId("leadChannels", "WhatsApp");
    for (const patch of [{ appSecret: SECRET }, { appId: APP_ID }, { appSecret: SECRET, appId: "abc" }]) {
      await expect(createSource(admin, { name: "Z", kind: "ZALO", channelId, ...patch })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
  });
});

describe("the signature (A-298)", () => {
  it("accepts mac=<hex> and the bare hex, and refuses a wrong secret, another app, a tampered body or no signature", async () => {
    const w = await world();
    expect(await deliver(w, text("m1"))).toEqual({ received: 1, duplicates: 0 });
    const body = text("m2");
    const raw = Buffer.from(JSON.stringify(body));
    const bare = zaloSignature(APP_ID, raw, body.timestamp, SECRET);
    expect(await receiveZalo(w.source.id, raw, bare.toUpperCase(), body)).toEqual({ received: 1, duplicates: 0 });

    const bad = text("m3");
    const badRaw = Buffer.from(JSON.stringify(bad));
    const attempts = [
      () => deliver(w, bad, { secret: "AnotherSecretKey0123456789ab" }),
      () => deliver(w, bad, { appId: "999999999999" }),
      () => deliver(w, { ...bad, app_id: "999999999999" }, { appId: "999999999999" }),
      () =>
        receiveZalo(
          w.source.id,
          Buffer.from(`${badRaw.toString()} `),
          `mac=${zaloSignature(APP_ID, badRaw, bad.timestamp, SECRET)}`,
          bad,
        ),
      () => receiveZalo(w.source.id, badRaw, undefined, bad),
      () => receiveZalo(w.source.id, badRaw, "mac=xyz", bad),
      () => receiveZalo("00000000-0000-4000-8000-000000000000", badRaw, `mac=${"0".repeat(64)}`, bad),
    ];
    for (const attempt of attempts) expect((await failure(attempt()))?.code).toBe("UNAUTHENTICATED");
    expect(await prisma.intakeMessage.count({ where: { externalId: "m3" } })).toBe(0);
  });

  it("refuses an event for a switched-off source", async () => {
    const w = await world();
    await updateSource(w.admin, w.source.id, { name: "Zalo OA", active: false, channelId: w.channelId });
    expect((await failure(deliver(w, text("m1"))))?.code).toBe("UNAUTHENTICATED");
  });
});

describe("a user writes to the OA (A-295 to A-297)", () => {
  it("makes a lead named after the user id, with the text as note and first message", async () => {
    const w = await world();
    await deliver(w, text("m1"));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Zalo 197922" } });
    expect(lead).toMatchObject({ phone: null, stage: "LEAD", channelId: w.channelId });
    expect(lead.notes).toContain("Cho mình hỏi giá PT");
    expect(lead.picUserId).not.toBeNull();
    const { items } = await listMessages(w.admin, lead.id);
    expect(items).toEqual([expect.objectContaining({ body: "Cho mình hỏi giá PT" })]);
    expect(items[0]!.source.kind).toBe("ZALO");
  });

  it("takes an event in once; follows and other events make nothing", async () => {
    const w = await world();
    const once = text("same");
    await deliver(w, once);
    expect(await deliver(w, once)).toEqual({ received: 0, duplicates: 1 });
    const follow = { app_id: APP_ID, event_name: "follow", follower: { id: USER }, timestamp: String(Date.now()) };
    expect(await deliver(w, follow)).toEqual({ received: 0, duplicates: 0 });
    expect(await prisma.customer.count()).toBe(1);
  });

  it("keeps the same user in one conversation within 24 hours, and makes an inquiry after", async () => {
    const w = await world();
    await deliver(w, text("m1"));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Zalo 197922" } });
    const inquiries = () => prisma.leadInquiry.count({ where: { personId: lead.id } });
    const before = await inquiries();
    await deliver(w, text("m2", "Tối nay còn lớp không?"));
    expect(await inquiries()).toBe(before);
    await prisma.intakeMessage.updateMany({
      where: { personId: lead.id },
      data: { receivedAt: new Date(Date.now() - CONVERSATION_WINDOW_MS - 60_000) },
    });
    await deliver(w, text("m3", "Em quay lại ạ"));
    expect(await inquiries()).toBe(before + 1);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("a user who shares a phone that a person already has goes to that person, and later messages follow", async () => {
    const w = await world();
    const known = await newLead(w.admin, "Bình", { phone: "0912345678" });
    await deliver(w, info("84912345678"));
    expect(await prisma.customer.count()).toBe(1);
    expect((await listMessages(w.admin, known.id)).items[0]?.body).toBe("Trần Thị Bình\n0912345678");
    await deliver(w, text("m9", "Bình đây ạ"));
    expect((await listMessages(w.admin, known.id)).items).toHaveLength(2);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("a new user who shares a phone first becomes a lead with that name and phone", async () => {
    const w = await world();
    await deliver(w, info("84912345678"));
    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0912345678" } });
    expect(lead.fullName).toBe("Trần Thị Bình");
  });

  it("keeps a script as text", async () => {
    const w = await world();
    await deliver(w, text("m1", "<script>alert(1)</script>"));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Zalo 197922" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe("<script>alert(1)</script>");
  });

  it("releases the claim when the lead cannot be made, so a later copy is taken in", async () => {
    const w = await world();
    await prisma.option.update({ where: { id: w.channelId }, data: { active: false } });
    const body = text("m1");
    expect((await failure(deliver(w, body)))?.code).toBe("VALIDATION_FAILED");
    expect(await prisma.intakeMessage.count()).toBe(0);
    await prisma.option.update({ where: { id: w.channelId }, data: { active: true } });
    expect(await deliver(w, body)).toEqual({ received: 1, duplicates: 0 });
  });
});
