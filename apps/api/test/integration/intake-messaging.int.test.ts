import { afterEach, describe, expect, it } from "vitest";
import {
  CONVERSATION_WINDOW_MS,
  answerMetaHandshake,
  createSource,
  listMessages,
  metaSignature,
  receiveMetaDelivery,
  updateSource,
} from "../../src/modules/intake/intake.service.js";
import { mergePersons } from "../../src/modules/leads/lead-merge.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import type { AppError } from "../../src/platform/errors/app-error.js";
import { resetDatabase } from "../support/database.js";
import { createTestOption, createTestUser, optionId } from "../support/factories.js";
import { newLead } from "../support/leads.js";

afterEach(resetDatabase);

// Messenger and Instagram as lead channels (M10.3; brief §11; D-044, D-019, BR-202; A-275 to A-280), against signed payloads as Meta
// posts them: one address for both kinds, the sender id as the only thread between a person's messages, and the merge that ties a
// sender to the customer it turns out to be.

const SECRET = "MessengerAppSecret0123456789abcdef";

async function world(kind: "MESSENGER" | "INSTAGRAM" = "MESSENGER") {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  await createTestUser("CONSULTING", { allBranches: true });
  const channelId = await optionId("leadChannels", "WhatsApp");
  const created = await createSource(admin, { name: kind, kind, channelId, appSecret: SECRET });
  return { admin, channelId, source: created.source, verifyToken: created.verifyToken!, kind };
}
type World = Awaited<ReturnType<typeof world>>;

const SENDER = "6543210987654321";
function payload(w: World, events: unknown[]) {
  return { object: w.kind === "MESSENGER" ? "page" : "instagram", entry: [{ id: "PAGE", time: 1, messaging: events }] };
}
const text = (mid: string, body = "Cho mình hỏi giá PT", sender = SENDER) => ({
  sender: { id: sender },
  recipient: { id: "PAGE" },
  timestamp: Date.now(),
  message: { mid, text: body },
});

function deliver(w: World, body: unknown, signature?: string) {
  const raw = Buffer.from(JSON.stringify(body));
  return receiveMetaDelivery("meta", w.source.id, raw, signature ?? metaSignature(raw, SECRET), body);
}
const failure = async (promise: Promise<unknown>) =>
  (await promise.then(
    () => null,
    (error: unknown) => error,
  )) as AppError | null;

describe("registering a Messenger or Instagram source (A-275)", () => {
  it("needs the app secret, keeps it sealed, and gives the shared Meta address and a verify token", async () => {
    for (const kind of ["MESSENGER", "INSTAGRAM"] as const) {
      const w = await world(kind);
      expect(w.source.webhookPath).toBe(`/api/v1/intake/meta/${w.source.id}`);
      const row = await prisma.intakeSource.findUniqueOrThrow({ where: { id: w.source.id } });
      expect(row).toMatchObject({ keyHash: null, kind });
      expect(row.secretEnc).not.toContain(SECRET);
      expect(await answerMetaHandshake("meta", w.source.id, ok(w))).toBe("77");
    }
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const channelId = await optionId("leadChannels", "WhatsApp");
    await expect(createSource(admin, { name: "M", kind: "MESSENGER", channelId })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("is reached only through its own address: WhatsApp's is not Messenger's and the other way round", async () => {
    const w = await world();
    expect((await failure(answerMetaHandshake("whatsapp", w.source.id, ok(w))))?.code).toBe("UNAUTHENTICATED");
    const body = payload(w, [text("m_1")]);
    const raw = Buffer.from(JSON.stringify(body));
    const wrongRoute = receiveMetaDelivery("whatsapp", w.source.id, raw, metaSignature(raw, SECRET), body);
    expect((await failure(wrongRoute))?.code).toBe("UNAUTHENTICATED");
    expect(await prisma.intakeMessage.count()).toBe(0);
  });
});

const ok = (w: World) => ({ "hub.mode": "subscribe", "hub.verify_token": w.verifyToken, "hub.challenge": "77" });

describe("the signature (A-276)", () => {
  it("refuses a wrong, missing or tampered delivery and a switched-off source, keeping nothing", async () => {
    const w = await world();
    const body = payload(w, [text("m_1")]);
    const raw = Buffer.from(JSON.stringify(body));
    for (const signature of [
      `sha256=${"0".repeat(64)}`,
      metaSignature(Buffer.from(`${raw.toString()} `), SECRET),
      "x",
    ]) {
      expect((await failure(deliver(w, body, signature)))?.code).toBe("UNAUTHENTICATED");
    }
    expect((await failure(receiveMetaDelivery("meta", w.source.id, raw, undefined, body)))?.code).toBe(
      "UNAUTHENTICATED",
    );
    await updateSource(w.admin, w.source.id, { name: "M", active: false, channelId: w.channelId });
    expect((await failure(deliver(w, body)))?.code).toBe("UNAUTHENTICATED");
    expect(await prisma.intakeMessage.count()).toBe(0);
  });
});

describe("a person writes (A-276 to A-279)", () => {
  it("makes a lead without a phone, named after the channel and the sender id, with the text as its note", async () => {
    const w = await world();
    expect(await deliver(w, payload(w, [text("m_1")]))).toEqual({ received: 1, duplicates: 0 });
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Messenger 654321" } });
    expect(lead).toMatchObject({ stage: "LEAD", phone: null, channelId: w.channelId });
    expect(lead.notes).toContain("Cho mình hỏi giá PT");
    expect(lead.picUserId).not.toBeNull();
    const { items } = await listMessages(w.admin, lead.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.source.kind).toBe("MESSENGER");
  });

  it("keeps the same sender in one conversation within 24 hours, and makes an inquiry on the same lead after", async () => {
    const w = await world();
    await deliver(w, payload(w, [text("m_1")]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Messenger 654321" } });
    const inquiries = () => prisma.leadInquiry.count({ where: { personId: lead.id } });
    const before = await inquiries();
    await deliver(w, payload(w, [text("m_2", "Tối nay còn lớp không?")]));
    expect(await prisma.customer.count()).toBe(1);
    expect(await inquiries()).toBe(before);

    await prisma.intakeMessage.updateMany({
      where: { personId: lead.id },
      data: { receivedAt: new Date(Date.now() - CONVERSATION_WINDOW_MS - 60_000) },
    });
    await deliver(w, payload(w, [text("m_3", "Em quay lại ạ")]));
    expect(await prisma.customer.count()).toBe(1);
    expect(await inquiries()).toBe(before + 1);
    expect((await listMessages(w.admin, lead.id)).items).toHaveLength(3);
  });

  it("makes separate leads for separate senders, and takes a message in once however often it comes", async () => {
    const w = await world();
    const body = payload(w, [text("m_1"), text("m_1"), text("m_9", "Hi", "1111112222223333")]);
    expect(await deliver(w, body)).toEqual({ received: 2, duplicates: 1 });
    expect(await deliver(w, body)).toEqual({ received: 0, duplicates: 3 });
    expect(await prisma.customer.count()).toBe(2);
    const results = await Promise.allSettled([
      deliver(w, payload(w, [text("m_race")])),
      deliver(w, payload(w, [text("m_race")])),
    ]);
    for (const result of results) {
      if (result.status === "rejected") expect((result.reason as AppError).code).toBe("INTAKE_IN_PROGRESS");
    }
    expect(await prisma.intakeMessage.count({ where: { externalId: "m_race" } })).toBe(1);
  });

  it("follows a sender merged into the customer it turned out to be (A-279)", async () => {
    const w = await world();
    await deliver(w, payload(w, [text("m_1")]));
    const messengerLead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Messenger 654321" } });
    const known = await newLead(w.admin, "Trần Thị Bình");
    // The consultant learns who it is and merges the two (D-019).
    const reasonId = await createTestOption("deleteReasons", `Trùng ${Math.random().toString(36).slice(2)}`);
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    await mergePersons(manager, known.id, { mergedId: messengerLead.id, reasonId, reasonNote: "" });
    const survivor = (await prisma.customer.findUniqueOrThrow({ where: { id: messengerLead.id } })).mergedIntoId
      ? known.id
      : messengerLead.id;
    // The conversation moved with the merge, and the next message goes to the survivor.
    expect((await listMessages(w.admin, survivor)).items).toHaveLength(1);
    await deliver(w, payload(w, [text("m_2", "Bình đây ạ")]));
    expect((await listMessages(w.admin, survivor)).items.map((message) => message.body)).toEqual([
      "Cho mình hỏi giá PT",
      "Bình đây ạ",
    ]);
    expect(await prisma.customer.count({ where: { mergedIntoId: null } })).toBe(1);
  });

  it("ignores our own replies, reads and the other product's bodies, and keeps attachments as their kind", async () => {
    const w = await world();
    const echo = { sender: { id: "PAGE" }, message: { mid: "m_echo", text: "Chào bạn", is_echo: true } };
    const read = { sender: { id: SENDER }, read: { watermark: 1 } };
    expect(await deliver(w, payload(w, [echo, read]))).toEqual({ received: 0, duplicates: 0 });
    expect(await deliver(w, { object: "instagram", entry: [{ messaging: [text("m_ig")] }] })).toEqual({
      received: 0,
      duplicates: 0,
    });
    const picture = { sender: { id: SENDER }, message: { mid: "m_pic", attachments: [{ type: "image" }] } };
    await deliver(w, payload(w, [picture]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Messenger 654321" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe("[image]");
  });

  it("reads Instagram the same way, under its own name", async () => {
    const w = await world("INSTAGRAM");
    await deliver(w, payload(w, [text("ig_1", "Hello", "17841400000000123")]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Instagram 000123" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.source.kind).toBe("INSTAGRAM");
  });

  it("keeps a script as text", async () => {
    const w = await world();
    await deliver(w, payload(w, [text("m_1", "<script>alert(1)</script>")]));
    const lead = await prisma.customer.findFirstOrThrow({ where: { fullName: "Messenger 654321" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe("<script>alert(1)</script>");
  });

  it("releases the claim when the lead cannot be made, so Meta's next delivery is taken in", async () => {
    const w = await world();
    await prisma.option.update({ where: { id: w.channelId }, data: { active: false } });
    const body = payload(w, [text("m_1")]);
    expect((await failure(deliver(w, body)))?.code).toBe("VALIDATION_FAILED");
    expect(await prisma.intakeMessage.count()).toBe(0);
    await prisma.option.update({ where: { id: w.channelId }, data: { active: true } });
    expect(await deliver(w, body)).toEqual({ received: 1, duplicates: 0 });
  });
});
