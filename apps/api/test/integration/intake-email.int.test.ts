import { afterEach, describe, expect, it } from "vitest";
import type { InboundEmailBody } from "@gymcrm/shared/intake";
import {
  CONVERSATION_WINDOW_MS,
  authenticateSource,
  createSource,
  listMessages,
  listSources,
  receiveEmail,
  receiveWebsiteLead,
} from "../../src/modules/intake/intake.service.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId } from "../support/factories.js";
import { newLead } from "../support/leads.js";

afterEach(resetDatabase);

// Gmail forwarding (M10.5; brief §11; D-044, D-019, BR-202; A-287 to A-293): the gym's Gmail forwards to an inbound-mail service,
// which posts each email with the source's key. Gmail's confirmation is for Admin, automatic mail is skipped, a person's email is a
// lead or joins the conversation of whoever has the address.

async function world() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  await createTestUser("CONSULTING", { allBranches: true });
  const channelId = await optionId("leadChannels", "WhatsApp");
  const created = await createSource(admin, { name: "Gmail", kind: "EMAIL", channelId });
  const source = (await authenticateSource(created.key!))!;
  return { admin, channelId, created, source };
}

let next = 0;
const mail = (patch: Partial<InboundEmailBody> = {}): InboundEmailBody => ({
  MessageID: `msg-${(next += 1)}`,
  FromFull: { Email: "an.nguyen@example.com", Name: "Nguyễn Văn An" },
  Subject: "Hỏi giá gói PT",
  TextBody: "Mình muốn tập PT buổi tối. SĐT 0909 123 456",
  Headers: [],
  ...patch,
});

describe("an email source (A-287)", () => {
  it("has a key like the website form, shown once, and the address to post to", async () => {
    const w = await world();
    expect(w.created.key).toMatch(/^fci_/);
    expect(w.created.verifyToken).toBeNull();
    expect(w.created.source.webhookPath).toBe("/api/v1/intake/email");
    const row = await prisma.intakeSource.findUniqueOrThrow({ where: { id: w.source.id } });
    expect(row).toMatchObject({ kind: "EMAIL", secretEnc: null });
    expect(row.keyHash).not.toBe(w.created.key);
  });
});

describe("a person's email (A-288, A-291, A-292)", () => {
  it("becomes a lead with the sender's address and name, the phone written in it, and the email as its first message", async () => {
    const w = await world();
    expect(await receiveEmail(w.source, mail())).toEqual({ received: 1, duplicates: 0 });
    const lead = await prisma.customer.findFirstOrThrow({ where: { email: "an.nguyen@example.com" } });
    expect(lead).toMatchObject({
      fullName: "Nguyễn Văn An",
      phone: "0909123456",
      stage: "LEAD",
      channelId: w.channelId,
    });
    expect(lead.notes).toContain("Mình muốn tập PT buổi tối");
    const { items } = await listMessages(w.admin, lead.id);
    expect(items).toEqual([
      expect.objectContaining({ body: "Hỏi giá gói PT\n\nMình muốn tập PT buổi tối. SĐT 0909 123 456" }),
    ]);
    expect(items[0]!.source.kind).toBe("EMAIL");
  });

  it("is taken in once however often the service posts it", async () => {
    const w = await world();
    const once = mail({ MessageID: "same" });
    await receiveEmail(w.source, once);
    expect(await receiveEmail(w.source, once)).toEqual({ received: 0, duplicates: 1 });
    expect(await prisma.customer.count()).toBe(1);
  });

  it("from an address someone already has joins that person, whatever phone it mentions (D-019)", async () => {
    const w = await world();
    const known = await newLead(w.admin, "An cũ", { email: "An.Nguyen@Example.com" });
    await receiveEmail(w.source, mail({ TextBody: "Số mới của mình 0911 222 333" }));
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.leadInquiry.count({ where: { personId: known.id } })).toBe(1);
    expect((await listMessages(w.admin, known.id)).items).toHaveLength(1);
  });

  it("without a known address but with a known phone joins the person who has the phone", async () => {
    const w = await world();
    const known = await newLead(w.admin, "An cũ", { phone: "0909123456" });
    await receiveEmail(w.source, mail({ FromFull: { Email: "new.address@example.com" } }));
    expect(await prisma.customer.count()).toBe(1);
    expect((await listMessages(w.admin, known.id)).items).toHaveLength(1);
  });

  it("keeps a reply within 24 hours in the conversation, and makes an inquiry after", async () => {
    const w = await world();
    await receiveEmail(w.source, mail());
    const lead = await prisma.customer.findFirstOrThrow({ where: { email: "an.nguyen@example.com" } });
    const inquiries = () => prisma.leadInquiry.count({ where: { personId: lead.id } });
    const before = await inquiries();
    await receiveEmail(w.source, mail({ Subject: "Re: Hỏi giá gói PT", StrippedTextReply: "Tối thứ 3 được không?" }));
    expect(await inquiries()).toBe(before);
    await prisma.intakeMessage.updateMany({
      where: { personId: lead.id },
      data: { receivedAt: new Date(Date.now() - CONVERSATION_WINDOW_MS - 60_000) },
    });
    await receiveEmail(w.source, mail({ Subject: "Hỏi lại" }));
    expect(await inquiries()).toBe(before + 1);
    expect((await listMessages(w.admin, lead.id)).items).toHaveLength(3);
  });

  it("keeps a script in the subject or body as text", async () => {
    const w = await world();
    await receiveEmail(
      w.source,
      mail({ Subject: "<script>alert(1)</script>", TextBody: "<img src=x onerror=alert(1)>" }),
    );
    const lead = await prisma.customer.findFirstOrThrow({ where: { email: "an.nguyen@example.com" } });
    expect((await listMessages(w.admin, lead.id)).items[0]?.body).toBe(
      "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>",
    );
  });
});

describe("emails no person wrote (A-289, A-290)", () => {
  it("keeps Gmail's confirmation of the forwarding rule on the source for Admin, and makes no lead", async () => {
    const w = await world();
    const confirmation = mail({
      FromFull: { Email: "forwarding-noreply@google.com", Name: "Gmail Team" },
      Subject: "(#987654321) Gmail Forwarding Confirmation",
      TextBody: "Confirmation code: 987654321",
    });
    expect(await receiveEmail(w.source, confirmation)).toEqual({ received: 0, duplicates: 0 });
    expect(await prisma.customer.count()).toBe(0);
    const { items } = await listSources(w.admin);
    expect(items[0]!.notice?.text).toContain("Confirmation code: 987654321");
  });

  it("skips auto-replies, bulk mail, mailing lists and bounces", async () => {
    const w = await world();
    for (const patch of [
      { Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }] },
      { Headers: [{ Name: "Precedence", Value: "bulk" }] },
      { Headers: [{ Name: "List-Id", Value: "<news.shop.vn>" }] },
      { FromFull: { Email: "mailer-daemon@googlemail.com" } },
    ]) {
      expect(await receiveEmail(w.source, mail(patch))).toEqual({ received: 0, duplicates: 0 });
    }
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.intakeMessage.count()).toBe(0);
  });

  it("refuses a body that is not an inbound email", async () => {
    const w = await world();
    await expect(receiveEmail(w.source, { hello: "world" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("the website form keeps its own rules", () => {
  it("still takes a submission with its key", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const channelId = await optionId("leadChannels", "WhatsApp");
    const created = await createSource(admin, { name: "Website", kind: "WEBSITE", channelId });
    const source = (await authenticateSource(created.key!))!;
    expect(await receiveWebsiteLead(source, { externalId: "f1", name: "An" })).toMatchObject({ duplicate: false });
  });
});
