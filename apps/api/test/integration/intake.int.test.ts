import { afterEach, describe, expect, it } from "vitest";
import {
  SUBMISSIONS_PER_MINUTE,
  authenticateSource,
  createSource,
  listMessages,
  listSources,
  receiveWebsiteLead,
  rotateSourceKey,
  updateSource,
  withinRate,
} from "../../src/modules/intake/intake.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";

afterEach(resetDatabase);

// The lead intake gateway (M10.1; brief §11; D-044, TS-007, D-019, BR-202; A-261 to A-267): a source with its own key hands over
// website submissions; a submission is one lead, or an inquiry on the person who has the phone, and is kept as a message.

async function world() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const channelId = await optionId("leadChannels", "WhatsApp");
  const { source, key } = await createSource(admin, { name: "Website", kind: "WEBSITE", channelId });
  const authenticated = (await authenticateSource(key))!;
  return { admin, channelId, source, key, authenticated };
}
type World = Awaited<ReturnType<typeof world>>;

const submit = (w: World, patch: Record<string, unknown> = {}) =>
  receiveWebsiteLead(w.authenticated, {
    externalId: "form-1",
    name: "Nguyễn Văn An",
    phone: "0909 123 456",
    email: "an@example.com",
    message: "Tôi muốn tập PT\nBuổi tối",
    pageUrl: "https://flow.vn/pt",
    ...patch,
  });

describe("the sources", () => {
  it("are registered by Admin with a key shown once; only its hash is kept", async () => {
    const w = await world();
    expect(w.key).toMatch(/^fci_[A-Za-z0-9_-]{40,}$/);
    const row = await prisma.intakeSource.findUniqueOrThrow({ where: { id: w.source.id } });
    expect(row.keyHash).not.toContain(w.key);
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(w.source).toMatchObject({
      name: "Website",
      kind: "WEBSITE",
      active: true,
      received: 0,
      lastReceivedAt: null,
    });
    expect((await listSources(w.admin)).items).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { action: "intake_source.created", entityId: w.source.id } })).toBe(
      1,
    );
  });

  it("are for Admin: others cannot list, register or change them", async () => {
    const w = await world();
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await expect(listSources(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createSource(manager, { name: "x", kind: "WEBSITE", channelId: w.channelId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      updateSource(manager, w.source.id, { name: "x", active: false, channelId: w.channelId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuse a kind that is not built yet, a channel that is not a channel, and 'Khác' for the channel", async () => {
    const { admin, channelId } = await world();
    for (const bad of [
      { name: "x", kind: "WHATSAPP", channelId },
      { name: "", kind: "WEBSITE", channelId },
      { name: "x", kind: "WEBSITE", channelId: "nope" },
      { name: "x", kind: "WEBSITE", channelId: await optionId("leadSources", "Khác") },
      { name: "x", kind: "WEBSITE", channelId: await optionId("leadChannels", "Khác") },
    ]) {
      await expect(createSource(admin, bad), JSON.stringify(bad)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("stop working when turned off, and a replaced key makes the old one useless at once", async () => {
    const w = await world();
    await updateSource(w.admin, w.source.id, { name: "Website", active: false, channelId: w.channelId });
    expect(await authenticateSource(w.key)).toBeNull();
    await updateSource(w.admin, w.source.id, { name: "Website", active: true, channelId: w.channelId });
    expect(await authenticateSource(w.key)).not.toBeNull();
    const rotated = await rotateSourceKey(w.admin, w.source.id);
    expect(await authenticateSource(w.key)).toBeNull();
    expect(await authenticateSource(rotated.key)).not.toBeNull();
  });

  it("recognise only a well-formed key", async () => {
    expect(await authenticateSource("")).toBeNull();
    expect(await authenticateSource("fci_short")).toBeNull();
    expect(await authenticateSource("fcd_" + "a".repeat(40))).toBeNull();
    expect(await authenticateSource("' OR 1=1 --")).toBeNull();
  });
});

describe("a website submission", () => {
  it("becomes a lead in the source's branch and channel, kept as a message with where it came from", async () => {
    const w = await world();
    const answer = await submit(w);
    expect(answer).toMatchObject({ stage: "LEAD", duplicate: false, existingPerson: false });
    expect(answer.code).toMatch(/^LD\d+/);
    const lead = await prisma.customer.findUniqueOrThrow({ where: { id: answer.personId } });
    expect(lead).toMatchObject({
      fullName: "Nguyễn Văn An",
      channelId: w.channelId,
      stage: "LEAD",
    });
    expect(lead.phone).toMatch(/^\+?\d{8,15}$/);
    expect(lead.email).toBe("an@example.com");
    expect(lead.notes).toContain("Tôi muốn tập PT");

    const messages = (await listMessages(w.admin, answer.personId)).items;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "IN", senderName: "Nguyễn Văn An", source: { name: "Website" } });
    expect(messages[0]!.body).toBe("Tôi muốn tập PT\nBuổi tối\n\n[https://flow.vn/pt]");
    expect((await listSources(w.admin)).items[0]).toMatchObject({ received: 1 });
    expect((await listSources(w.admin)).items[0]!.lastReceivedAt).not.toBeNull();
  });

  it("sent twice is one lead: the repeat is told which person it already made", async () => {
    const w = await world();
    const first = await submit(w);
    const again = await submit(w);
    expect(again).toMatchObject({ personId: first.personId, duplicate: true });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.intakeMessage.count()).toBe(1);
  });

  it("sent twice at the same moment is still one lead", async () => {
    const w = await world();
    const results = await Promise.allSettled([submit(w), submit(w)]);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.intakeMessage.count()).toBe(1);
    // The slower copy is told the person, or to try again in a moment while the first is being made.
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "INTAKE_IN_PROGRESS" });
    }
  });

  it("from a phone that already has a record is added to that person, not made a second person (D-019, BR-202)", async () => {
    const w = await world();
    const first = await submit(w);
    const second = await submit(w, { externalId: "form-2", name: "An", message: "Hỏi thêm về giá" });
    expect(second).toMatchObject({ personId: first.personId, duplicate: false, existingPerson: true });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.leadInquiry.count({ where: { personId: first.personId } })).toBe(1);
    expect((await listMessages(w.admin, first.personId)).items.map((message) => message.body)).toEqual([
      "Tôi muốn tập PT\nBuổi tối\n\n[https://flow.vn/pt]",
      "Hỏi thêm về giá\n\n[https://flow.vn/pt]",
    ]);
  });

  it("needs only a name and the form's own id: no phone, no message", async () => {
    const w = await world();
    const answer = await receiveWebsiteLead(w.authenticated, { externalId: "x1", name: "Khách ẩn danh" });
    expect(answer).toMatchObject({ stage: "LEAD", existingPerson: false });
    const lead = await prisma.customer.findUniqueOrThrow({ where: { id: answer.personId } });
    expect(lead.phone).toBeNull();
    // Two without a phone are two people: nothing says they are one (D-060).
    await receiveWebsiteLead(w.authenticated, { externalId: "x2", name: "Khách ẩn danh" });
    expect(await prisma.customer.count()).toBe(2);
  });

  it("is refused for missing or bad fields, scripts stay text, and an unknown field is refused", async () => {
    const w = await world();
    for (const bad of [
      {},
      { externalId: "e", name: "" },
      { externalId: "", name: "An" },
      { externalId: "e", name: "An", phone: "abc" },
      { externalId: "e", name: "An", email: "not-an-email" },
      { externalId: "e", name: "a\u0007b" },
      { externalId: "e", name: "An", message: "x".repeat(4001) },
      { externalId: "e", name: "An", message: "bell\u0007" },
      { externalId: "e", name: "An", channelId: "someone-elses" },
    ]) {
      await expect(receiveWebsiteLead(w.authenticated, bad), JSON.stringify(bad).slice(0, 60)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    const script = "<script>alert(1)</script>";
    const answer = await receiveWebsiteLead(w.authenticated, { externalId: "s", name: script, message: script });
    const lead = await prisma.customer.findUniqueOrThrow({ where: { id: answer.personId } });
    expect(lead.fullName).toBe(script);
    expect((await listMessages(w.admin, answer.personId)).items[0]!.body).toBe(script);
    expect(await prisma.intakeMessage.count()).toBe(1);
  });

  it("that fails leaves nothing behind, so the sender can try again with the same id", async () => {
    const w = await world();
    // The channel was turned off after the source was made: the lead cannot be made.
    await prisma.option.update({ where: { id: w.channelId }, data: { active: false } });
    await expect(submit(w)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await prisma.intakeMessage.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
    await prisma.option.update({ where: { id: w.channelId }, data: { active: true } });
    expect(await submit(w)).toMatchObject({ duplicate: false });
  });
});

describe("the conversation of a person", () => {
  it("is read by those who may see the person; a role without lead.view is refused", async () => {
    const w = await world();
    const answer = await submit(w);
    const { actor: pt } = await createTestUser("PT");
    await expect(listMessages(pt, answer.personId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listMessages(w.admin, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the rate of a source", () => {
  it("allows a number of submissions a minute and then says no until the minute is over", () => {
    const id = "00000000-0000-4000-8000-0000000000aa";
    const start = 1_000_000;
    for (let count = 0; count < SUBMISSIONS_PER_MINUTE; count += 1) expect(withinRate(id, start + count)).toBe(true);
    expect(withinRate(id, start + 1000)).toBe(false);
    expect(withinRate(id, start + 61_000)).toBe(true);
  });
});
