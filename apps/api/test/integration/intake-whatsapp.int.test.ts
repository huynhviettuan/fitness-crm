import { afterEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_WINDOW_MS,
  answerMetaHandshake,
  createSource,
  listMessages,
  receiveMetaDelivery,
  rotateSourceKey,
  updateSource,
  metaSignature,
} from "../../src/modules/intake/intake.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { type AppError } from "../../src/platform/errors/app-error.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";
import { newLead } from "../support/leads.js";

afterEach(resetDatabase);

// WhatsApp as a lead channel (M10.2; brief §11; D-044, D-019, BR-202; A-268 to A-274), against signed payloads as Meta posts them:
// the handshake, the signature over the exact bytes, one message once, a returning phone, and one conversation within 24 hours.

const SECRET = "s3cretAppSecret0123456789abcdef";

async function world() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const channelId = await optionId("leadChannels", "WhatsApp");
  // A consultant in turn to be given the lead (D-050).
  await createTestUser("CONSULTING", { allBranches: true });
  const created = await createSource(admin, { name: "WhatsApp", kind: "WHATSAPP", channelId, appSecret: SECRET });
  return { admin, channelId, source: created.source, verifyToken: created.verifyToken! };
}
type World = Awaited<ReturnType<typeof world>>;

function payload(messages: unknown[], name = "Nguyễn Văn An") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [{ field: "messages", value: { contacts: [{ wa_id: "84909123456", profile: { name } }], messages } }],
      },
    ],
  };
}
const text = (id: string, body = "Tôi muốn tập thử", extra: Record<string, unknown> = {}) => ({
  from: "84909123456",
  id,
  timestamp: String(Math.floor(Date.now() / 1000)),
  type: "text",
  text: { body },
  ...extra,
});

/** Posts a delivery the way Meta does: the body as bytes, signed. */
function deliver(w: World, body: unknown, options: { secret?: string; signature?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = options.signature ?? metaSignature(raw, options.secret ?? SECRET);
  return receiveMetaDelivery("whatsapp", w.source.id, raw, signature, body);
}
const failure = async (promise: Promise<unknown>) =>
  (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as AppError | null;

describe("registering a WhatsApp source (A-268)", () => {
  it("keeps the app secret sealed and the verify token only as a hash, and shows the token once", async () => {
    const w = await world();
    expect(w.verifyToken.length).toBeGreaterThan(20);
    expect(w.source.webhookPath).toBe(`/api/v1/intake/whatsapp/${w.source.id}`);
    const row = await prisma.intakeSource.findUniqueOrThrow({ where: { id: w.source.id } });
    expect(row.keyHash).toBeNull();
    expect(row.secretEnc).not.toBeNull();
    expect(row.secretEnc).not.toContain(SECRET);
    expect(row.verifyTokenHash).not.toBe(w.verifyToken);
    expect(JSON.stringify(row)).not.toContain(w.verifyToken);
    const audit = await prisma.auditEvent.findMany({ where: { entityType: "intake_source", entityId: w.source.id } });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    expect(JSON.stringify(audit)).not.toContain(w.verifyToken);
  });

  it("is refused without the app secret, and a website source cannot carry one", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const channelId = await optionId("leadChannels", "WhatsApp");
    await expect(createSource(admin, { name: "W", kind: "WHATSAPP", channelId })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      createSource(admin, { name: "W", kind: "WEBSITE", channelId, appSecret: SECRET }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("gets a new verify token when re-keyed, and the old one stops working", async () => {
    const w = await world();
    const query = (token: string) => ({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" });
    expect(await answerMetaHandshake("whatsapp", w.source.id, query(w.verifyToken))).toBe("42");
    const rotated = await rotateSourceKey(w.admin, w.source.id);
    expect(rotated.key).toBeNull();
    expect((await failure(answerMetaHandshake("whatsapp", w.source.id, query(w.verifyToken))))?.code).toBe(
      "UNAUTHENTICATED",
    );
    expect(await answerMetaHandshake("whatsapp", w.source.id, query(rotated.verifyToken!))).toBe("42");
  });
});

describe("Meta's handshake (A-271)", () => {
  it("echoes the challenge for the right token only, and the same refusal for everything else", async () => {
    const w = await world();
    const ok = { "hub.mode": "subscribe", "hub.verify_token": w.verifyToken, "hub.challenge": "158772" };
    expect(await answerMetaHandshake("whatsapp", w.source.id, ok)).toBe("158772");
    const refused = [
      await failure(answerMetaHandshake("whatsapp", w.source.id, { ...ok, "hub.verify_token": "wrong" })),
      await failure(
        answerMetaHandshake("whatsapp", w.source.id, { ...ok, "hub.challenge": "<script>alert(1)</script>" }),
      ),
      await failure(answerMetaHandshake("whatsapp", w.source.id, { ...ok, "hub.mode": "unsubscribe" })),
      await failure(answerMetaHandshake("whatsapp", w.source.id, {})),
      await failure(answerMetaHandshake("whatsapp", "00000000-0000-4000-8000-000000000000", ok)),
      await failure(answerMetaHandshake("whatsapp", "not-a-uuid", ok)),
    ];
    for (const error of refused) expect(error?.code).toBe("UNAUTHENTICATED");
    await updateSource(w.admin, w.source.id, { name: "WhatsApp", active: false, channelId: w.channelId });
    expect((await failure(answerMetaHandshake("whatsapp", w.source.id, ok)))?.code).toBe("UNAUTHENTICATED");
  });
});

describe("the signature (A-270)", () => {
  it("refuses a missing, wrong, other-secret or tampered delivery and keeps nothing", async () => {
    const w = await world();
    const body = payload([text("wamid.1")]);
    const raw = Buffer.from(JSON.stringify(body));
    const attempts = [
      () => receiveMetaDelivery("whatsapp", w.source.id, raw, undefined, body),
      () => receiveMetaDelivery("whatsapp", w.source.id, raw, `sha256=${"0".repeat(64)}`, body),
      () => receiveMetaDelivery("whatsapp", w.source.id, raw, metaSignature(raw, "another-secret-0123456789"), body),
      () =>
        receiveMetaDelivery(
          "whatsapp",
          w.source.id,
          raw,
          metaSignature(Buffer.from(`${raw.toString()} `), SECRET),
          body,
        ),
      () => receiveMetaDelivery("whatsapp", w.source.id, raw, "garbage", body),
      () => receiveMetaDelivery("whatsapp", w.source.id, undefined, metaSignature(raw, SECRET), body),
      () =>
        receiveMetaDelivery("whatsapp", "00000000-0000-4000-8000-000000000000", raw, metaSignature(raw, SECRET), body),
    ];
    for (const attempt of attempts) expect((await failure(attempt()))?.code).toBe("UNAUTHENTICATED");
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.intakeMessage.count()).toBe(0);
  });

  it("refuses a delivery for a switched-off source", async () => {
    const w = await world();
    await updateSource(w.admin, w.source.id, { name: "WhatsApp", active: false, channelId: w.channelId });
    expect((await failure(deliver(w, payload([text("wamid.1")]))))?.code).toBe("UNAUTHENTICATED");
  });
});

describe("a customer writes (A-269, A-270, A-272)", () => {
  it("makes a lead from the first message, with the local phone, the profile name, the channel and the text as its note", async () => {
    const w = await world();
    expect(await deliver(w, payload([text("wamid.1", "Tôi muốn tập PT")]))).toEqual({ received: 1, duplicates: 0 });
    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0909123456" } });
    expect(lead).toMatchObject({ fullName: "Nguyễn Văn An", stage: "LEAD", channelId: w.channelId });
    expect(lead.notes).toContain("Tôi muốn tập PT");
    expect(lead.picUserId).not.toBeNull();
    const { items } = await listMessages(w.admin, lead.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ direction: "IN", body: "Tôi muốn tập PT", senderName: "Nguyễn Văn An" });
    expect(items[0]!.source.kind).toBe("WHATSAPP");
  });

  it("takes a retried delivery in once, even when the same message comes twice in one delivery", async () => {
    const w = await world();
    const body = payload([text("wamid.1"), text("wamid.1")]);
    // Two copies in one delivery: the first is taken in, the second is a repeat.
    expect(await deliver(w, body)).toEqual({ received: 1, duplicates: 1 });
    expect(await deliver(w, body)).toEqual({ received: 0, duplicates: 2 });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.intakeMessage.count()).toBe(1);
  });

  it("takes simultaneous copies of one message in once", async () => {
    const w = await world();
    const body = payload([text("wamid.race")]);
    const results = await Promise.allSettled([deliver(w, body), deliver(w, body), deliver(w, body)]);
    for (const result of results) {
      if (result.status === "rejected") expect((result.reason as AppError).code).toBe("INTAKE_IN_PROGRESS");
    }
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.intakeMessage.count()).toBe(1);
  });

  it("keeps a follow-up within 24 hours in the same conversation: no second inquiry, the consultant is told", async () => {
    const w = await world();
    await deliver(w, payload([text("wamid.1")]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0909123456" } });
    const inquiries = await prisma.leadInquiry.count({ where: { personId: lead.id } });
    const before = await prisma.notification.count({ where: { userId: lead.picUserId! } });
    await deliver(w, payload([text("wamid.2", "Giá bao nhiêu?")]));
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.leadInquiry.count({ where: { personId: lead.id } })).toBe(inquiries);
    expect(await prisma.notification.count({ where: { userId: lead.picUserId! } })).toBe(before + 1);
    const { items } = await listMessages(w.admin, lead.id);
    expect(items.map((message) => message.body)).toEqual(["Tôi muốn tập thử", "Giá bao nhiêu?"]);
  });

  it("makes an inquiry, not a second lead, when the customer writes again after the day is over", async () => {
    const w = await world();
    await deliver(w, payload([text("wamid.1")]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0909123456" } });
    await prisma.intakeMessage.updateMany({
      where: { personId: lead.id },
      data: { receivedAt: new Date(Date.now() - CONVERSATION_WINDOW_MS - 60_000) },
    });
    const inquiries = await prisma.leadInquiry.count({ where: { personId: lead.id } });
    await deliver(w, payload([text("wamid.2", "Em quay lại ạ")]));
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.leadInquiry.count({ where: { personId: lead.id } })).toBe(inquiries + 1);
    expect((await listMessages(w.admin, lead.id)).items).toHaveLength(2);
  });

  it("matches a customer who already has the phone, as an inquiry on that person (D-019)", async () => {
    const w = await world();
    const existing = await newLead(w.admin, "An cũ", { phone: "0909123456" });
    await deliver(w, payload([text("wamid.1")]));
    expect(await prisma.customer.count()).toBe(1);
    expect((await listMessages(w.admin, existing.id)).items).toHaveLength(1);
  });

  it("leaves an unknown kind of message as a note of its kind, and ignores delivery statuses", async () => {
    const w = await world();
    const status = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.s", status: "read" }] } }] }] };
    expect(await deliver(w, status)).toEqual({ received: 0, duplicates: 0 });
    expect(await prisma.customer.count()).toBe(0);
    await deliver(w, payload([text("wamid.3", "", { type: "audio", text: undefined })]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0909123456" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe("[audio]");
  });

  it("keeps a script as text", async () => {
    const w = await world();
    const script = "<script>alert(1)</script>";
    await deliver(w, payload([text("wamid.1", script)], script));
    const lead = await prisma.customer.findFirstOrThrow({ where: { phone: "0909123456" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe(script);
  });

  it("releases the claim when the lead cannot be made, so Meta's next delivery is taken in", async () => {
    const w = await world();
    // The channel was turned off after the source was made: the lead cannot be made.
    await prisma.option.update({ where: { id: w.channelId }, data: { active: false } });
    const body = payload([text("wamid.1")]);
    expect((await failure(deliver(w, body)))?.code).toBe("VALIDATION_FAILED");
    expect(await prisma.intakeMessage.count()).toBe(0);
    await prisma.option.update({ where: { id: w.channelId }, data: { active: true } });
    expect(await deliver(w, body)).toEqual({ received: 1, duplicates: 0 });
  });
});
