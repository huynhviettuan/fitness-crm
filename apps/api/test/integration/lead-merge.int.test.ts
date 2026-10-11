import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { setUserStatus } from "../../src/modules/users/user.service.js";
import { createCustomer, getCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import { getLead, listLeads, updateLead } from "../../src/modules/leads/lead.service.js";
import { assignLead, changeLeadStatus, leadTimeline } from "../../src/modules/leads/lead-journey.service.js";
import { createLead } from "../../src/modules/leads/lead.service.js";
import { addInquiry, personIntakeHistory } from "../../src/modules/leads/lead-inquiry.service.js";
import { mergePersons } from "../../src/modules/leads/lead-merge.service.js";
import { recareList } from "../../src/modules/leads/lead-recare.service.js";
import { completeLeadStep, leadChecklist } from "../../src/modules/leads/checklist.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestOption,
  createTestUser,
  inRoundRobinOrder,
  optionId,
  uniquePhone,
} from "../support/factories.js";
import { gymDay, intoRecare, newLead } from "../support/leads.js";

// One person, one record (D-019, BR-202, FR-LEAD-009): a repeated phone offers a merge, an
// inquiry joins the record, and managers merge two records of one person (A-063..A-067).

afterEach(async () => {
  await resetDatabase();
});

const WHATSAPP = await optionId("leadChannels", "WhatsApp");
const ZALO = await optionId("leadChannels", "Zalo");
const FANPAGE = await optionId("leadSources", "Fanpage");
const PAIN_RELIEF = await optionId("needGroups", "2 - Pain Relief & Better Movement");
const BODY = await optionId("needGroups", "1 - Body Transformation");
const OTHER_CHANNEL = await optionId("leadChannels", "Khác");
const mergeReason = () => createTestOption("deleteReasons", `Trùng ${Math.random().toString(36).slice(2)}`);

const inquiry = (extra: Record<string, unknown> = {}) => ({ channelId: ZALO, ...extra });

/** Merge the pair as a manager; the survivor is the system's choice, not `id`'s. */
async function merge(actor: Parameters<typeof mergePersons>[0], id: string, mergedId: string, note = "") {
  return mergePersons(actor, id, { mergedId, reasonId: await mergeReason(), reasonNote: note });
}

/** Makes `older` the older record. */
const makeOlder = (id: string) =>
  prisma.customer.update({ where: { id }, data: { createdAt: new Date("2026-01-01") } });

describe("intake with a phone already in use (D-019, BR-202)", () => {
  it("answers DUPLICATE_PHONE with the existing record and creates nobody", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const lead = await newLead(reception, "Lê Hoa", { phone: "0933111222" });
    const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const before = await prisma.customer.count();

    await expect(
      createLead(reception, { fullName: "Hoa", phone: "0933.111.222", channelId: ZALO }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_PHONE",
      duplicate: { id: lead.id, stage: "LEAD", code: lead.leadCode, fullName: "Lê Hoa" },
    });
    await expect(createLead(reception, { fullName: "An", phone: "0909123456", channelId: ZALO })).rejects.toMatchObject(
      {
        code: "DUPLICATE_PHONE",
        duplicate: { id: customer.id, stage: "CUSTOMER", code: customer.customerCode, fullName: "Nguyễn Văn An" },
      },
    );

    expect(await prisma.customer.count()).toBe(before);
    expect(await prisma.leadInquiry.count()).toBe(0);
  });

  it("names the record only to someone who may see it", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const mine = await newLead(reception, "Của người khác", { phone: "0944555666" });
    const { actor: stranger } = await createTestUser("CONSULTING");

    const seen = await createLead(consultant, { fullName: "A", phone: "0944555666", channelId: ZALO }).catch((e) => e);
    const hidden = await createLead(stranger, { fullName: "A", phone: "0944555666", channelId: ZALO }).catch((e) => e);

    expect(seen).toMatchObject({ code: "DUPLICATE_PHONE", duplicate: { id: mine.id } });
    expect(hidden).toMatchObject({ code: "DUPLICATE_PHONE", duplicate: undefined });
    expect(JSON.stringify(hidden)).not.toContain(mine.leadCode);
  });

  it("lets one of two leads with the same phone in when they arrive together", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const phone = uniquePhone();

    const results = await Promise.allSettled(
      ["A", "B"].map((fullName) => createLead(reception, { fullName, phone, channelId: ZALO })),
    );

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "DUPLICATE_PHONE" } });
    expect(await prisma.customer.count({ where: { phone } })).toBe(1);
  });

  it("keeps PHONE_ALREADY_USED for edits and customers", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const first = await newLead(reception, "Một", { phone: "0933111222" });
    const second = await newLead(reception, "Hai");

    await expect(
      updateLead(reception, second.id, { fullName: "Hai", phone: "0933111222", channelId: WHATSAPP }),
    ).rejects.toMatchObject({ code: "PHONE_ALREADY_USED", duplicate: { id: first.id } });
    await expect(createCustomer(reception, { fullName: "Ba", phone: "0933111222" })).rejects.toMatchObject({
      code: "PHONE_ALREADY_USED",
    });
  });
});

describe("a new inquiry on an existing record (BR-202, FR-LEAD-009, A-063)", () => {
  async function liveLead() {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const lead = await newLead(reception, "Trần Thị Mai");
    return { reception, manager, consultant, lead };
  }
  const notified = (userId: string, kind: string) => prisma.notification.count({ where: { userId, kind } });

  it("adds the inquiry to a live lead without a new person; the consultant stays and is told", async () => {
    const { reception, consultant, lead } = await liveLead();
    const people = await prisma.customer.count();

    const result = await addInquiry(
      reception,
      lead.id,
      inquiry({
        sourceId: FANPAGE,
        sourceType: "PAID",
        needGroupId: PAIN_RELIEF,
        needDetail: "Đau vai",
        note: "Hỏi lại giá",
      }),
    );

    expect(result).toMatchObject({
      personId: lead.id,
      stage: "LEAD",
      code: lead.leadCode,
      reopened: false,
      pic: { id: consultant.id },
      inquiry: {
        kind: "inquiry",
        channel: { id: ZALO },
        source: { id: FANPAGE },
        sourceType: "PAID",
        needGroup: { id: PAIN_RELIEF },
        needDetail: "Đau vai",
        note: "Hỏi lại giá",
        by: { id: reception.id },
      },
    });
    expect(await prisma.customer.count()).toBe(people);
    expect(await getLead(reception, lead.id)).toMatchObject({ status: "CONSULTING", pic: { id: consultant.id } });
    expect(await notified(consultant.id, "leadInquiry")).toBe(1);
    const row = await prisma.leadInquiry.findFirstOrThrow({ where: { personId: lead.id } });
    expect(row).toMatchObject({ branchId: DEFAULT_BRANCH_ID, createdById: reception.id, channelId: ZALO });
    expect(await prisma.auditEvent.count({ where: { entityId: lead.id, action: { contains: "inquir" } } })).toBe(1);
  });

  it("shows the inquiries on the timeline, newest first, and in the intake history", async () => {
    const { reception, lead } = await liveLead();
    await addInquiry(reception, lead.id, inquiry({ note: "Lần một" }));
    await addInquiry(reception, lead.id, inquiry({ channelId: WHATSAPP, note: "Lần hai" }));

    const timeline = await leadTimeline(reception, lead.id);
    const inquiries = timeline.items.filter((entry) => entry.kind === "inquiry");

    expect(inquiries.map((entry) => entry.note)).toEqual(["Lần hai", "Lần một"]);
    expect(timeline.items.indexOf(inquiries[0])).toBeLessThan(timeline.items.length - 1);
    const history = await personIntakeHistory(reception, lead.id);
    expect(history.items.map((entry) => entry.kind)).toEqual(["inquiry", "inquiry"]);
  });

  it.each(["NO_RESPONSE", "REFUSED", "NO_SHOW"] as const)(
    "brings a lead in %s back to Consulting with its consultant, out of the re-care list",
    async (status) => {
      const { reception, consultant, lead } = await liveLead();
      await intoRecare(consultant, lead.id, status, gymDay(-1));

      const result = await addInquiry(reception, lead.id, inquiry());

      expect(result).toMatchObject({ reopened: true, pic: { id: consultant.id } });
      expect(await getLead(reception, lead.id)).toMatchObject({
        status: "CONSULTING",
        pic: { id: consultant.id },
        contactAgainOn: null,
        refuseReason: null,
      });
      expect((await recareList(consultant, {})).total).toBe(0);
      expect(
        await prisma.leadStatusChange.count({
          where: { customerId: lead.id, fromStatus: status, toStatus: "CONSULTING" },
        }),
      ).toBe(1);
      expect(await notified(consultant.id, "leadInquiry")).toBe(1);
    },
  );

  it("does not move a lead that is Booked", async () => {
    const { reception, consultant, lead } = await liveLead();
    await changeLeadStatus(consultant, lead.id, {
      status: "BOOKED",
      appointmentDate: "20/10/2030",
      appointmentTime: "18:30",
    });

    const result = await addInquiry(reception, lead.id, inquiry());

    expect(result.reopened).toBe(false);
    expect((await getLead(reception, lead.id)).status).toBe("BOOKED");
  });

  it("goes round-robin when the consultant no longer receives leads", async () => {
    const { reception, consultant, lead } = await liveLead();
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: next } = await createTestUser("CONSULTING");
    await inRoundRobinOrder(consultant.id, next.id);
    await intoRecare(consultant, lead.id, "NO_RESPONSE", gymDay(-1));
    await setUserStatus(admin, { userId: consultant.id, status: "DISABLED" });

    const result = await addInquiry(reception, lead.id, inquiry());

    expect(result.pic?.id).toBe(next.id);
    expect(await getLead(reception, lead.id)).toMatchObject({ status: "CONSULTING", pic: { id: next.id } });
  });

  it("is only recorded on a customer; the person in charge and managers are told, no status", async () => {
    const { reception, manager } = await liveLead();
    const customer = await createCustomer(reception, { fullName: "Khách cũ", phone: uniquePhone() });

    const result = await addInquiry(reception, customer.id, inquiry({ note: "Muốn gia hạn" }));

    expect(result).toMatchObject({
      personId: customer.id,
      stage: "CUSTOMER",
      code: customer.customerCode,
      reopened: false,
      inquiry: { note: "Muốn gia hạn" },
    });
    expect(await notified(manager.id, "leadInquiry")).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).leadStatus).toBeNull();
    expect((await personIntakeHistory(reception, customer.id)).items).toHaveLength(1);
    expect((await listCustomers(reception, {})).total).toBe(1);
    await expect(getLead(reception, customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes only a record the user may see, and needs lead.create", async () => {
    const { reception, lead } = await liveLead();
    const { actor: stranger } = await createTestUser("CONSULTING");
    const { actor: pt } = await createTestUser("PT");
    const elsewhere = await createTestBranch();
    const { actor: remote } = await createTestUser("RECEPTIONIST", { branchIds: [elsewhere.id] });

    await expect(addInquiry(stranger, lead.id, inquiry())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addInquiry(remote, lead.id, inquiry())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addInquiry(pt, lead.id, inquiry())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addInquiry(reception, "not-a-uuid", inquiry())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(personIntakeHistory(stranger, lead.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.leadInquiry.count()).toBe(0);
  });

  it("refuses bad input with field errors", async () => {
    const { reception, lead } = await liveLead();

    await expect(addInquiry(reception, lead.id, {})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { channelId: ["required"] },
    });
    await expect(addInquiry(reception, lead.id, { channelId: OTHER_CHANNEL })).rejects.toMatchObject({
      fieldErrors: { channelNote: ["otherNeedsNote"] },
    });
    await expect(addInquiry(reception, lead.id, inquiry({ sourceId: ZALO }))).rejects.toMatchObject({
      fieldErrors: { sourceId: ["invalidChoice"] },
    });
    await expect(addInquiry(reception, lead.id, inquiry({ note: "a\u0007b" }))).rejects.toMatchObject({
      fieldErrors: { note: ["invalidCharacters"] },
    });
    expect(await prisma.leadInquiry.count()).toBe(0);
  });

  it("ignores fields the client has no say in", async () => {
    const { reception, lead } = await liveLead();
    const { actor: other } = await createTestUser("ADMIN");

    await addInquiry(
      reception,
      lead.id,
      inquiry({ createdById: other.id, branchId: (await createTestBranch()).id, id: lead.id }),
    );

    expect(await prisma.leadInquiry.findFirstOrThrow({ where: { personId: lead.id } })).toMatchObject({
      createdById: reception.id,
      branchId: DEFAULT_BRANCH_ID,
    });
  });
});

describe("merging two records of one person (BR-202, D-019, A-064..A-067)", () => {
  async function twoLeads() {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const older = await newLead(reception, "Nguyễn An (cũ)", {
      phone: "0911000111",
      channelId: WHATSAPP,
      needGroupId: PAIN_RELIEF,
      gender: "MALE",
    });
    const newer = await newLead(reception, "Nguyễn An (mới)", {
      phone: "0911000222",
      channelId: ZALO,
      needGroupId: BODY,
      email: "an@example.com",
      birthDate: "15/03/1990",
    });
    await makeOlder(older.id);
    return { reception, manager, consultant, older, newer };
  }

  it("keeps the older lead and its codes; the merged one goes to the trash with the reason, its codes reserved", async () => {
    const { manager, older, newer } = await twoLeads();
    const reasonId = await mergeReason();

    // The path names the newer record, the older still survives.
    const result = await mergePersons(manager, newer.id, { mergedId: older.id, reasonId, reasonNote: "" });
    expect(result).toEqual({ survivorId: older.id, mergedId: newer.id, stage: "LEAD" });

    const gone = await prisma.customer.findUniqueOrThrow({ where: { id: newer.id } });
    expect(gone).toMatchObject({ mergedIntoId: older.id, phone: null, leadCode: newer.leadCode });
    expect(gone.mergedAt).toBeInstanceOf(Date);
    const kept = await prisma.customer.findUniqueOrThrow({ where: { id: older.id } });
    expect(kept).toMatchObject({ leadCode: older.leadCode, mergedIntoId: null, phone: "0911000111" });
    expect(
      await prisma.trashEntry.findUnique({
        where: { entityType_entityId: { entityType: "person", entityId: newer.id } },
      }),
    ).toMatchObject({
      reasonId,
      deletedById: manager.id,
    });
    expect(await prisma.personMerge.findUniqueOrThrow({ where: { mergedId: newer.id } })).toMatchObject({
      survivorId: older.id,
      reasonId,
      mergedById: manager.id,
    });
    // Hidden everywhere.
    await expect(getLead(manager, newer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listLeads(manager, {})).items.map((l) => l.id)).toEqual([older.id]);
    expect((await listLeads(manager, { q: "0911000222" })).total).toBe(0);
    // Codes are never reused: the next lead takes a new number.
    const next = await newLead(manager, "Người khác");
    expect([older.leadCode, newer.leadCode]).not.toContain(next.leadCode);
  });

  it("chooses the same survivor whichever record the request names first", async () => {
    const { manager, older, newer } = await twoLeads();

    const result = await merge(manager, older.id, newer.id);

    expect(result).toMatchObject({ survivorId: older.id, mergedId: newer.id });
  });

  it("lists 'merged from' on the survivor's timeline and the merge in its intake history", async () => {
    const { manager, older, newer } = await twoLeads();
    const reasonId = await mergeReason();
    await mergePersons(manager, older.id, { mergedId: newer.id, reasonId, reasonNote: "" });

    const entry = (await leadTimeline(manager, older.id)).items.find((item) => item.kind === "merge");
    const history = await personIntakeHistory(manager, older.id);

    expect(entry).toMatchObject({
      kind: "merge",
      mergedLeadCode: newer.leadCode,
      mergedCustomerCode: null,
      mergedName: "Nguyễn An (mới)",
      reason: { id: reasonId },
      by: { id: manager.id },
    });
    expect(history.items.map((item) => item.kind)).toContain("merge");
  });

  it("moves the merged record's history and work to the survivor and closes duplicate steps", async () => {
    const { reception, manager, consultant, older, newer } = await twoLeads();
    await addInquiry(reception, newer.id, inquiry({ note: "Từ hồ sơ mới" }));
    const task = await prisma.task.create({
      data: {
        branchId: DEFAULT_BRANCH_ID,
        title: "Gọi lại",
        assignerId: manager.id,
        assigneeUserId: consultant.id,
        dueAt: new Date(Date.now() + 86_400_000),
        entityType: "lead",
        entityId: newer.id,
      },
    });
    const statusChanges = await prisma.leadStatusChange.count({ where: { customerId: newer.id } });
    const assignments = await prisma.leadAssignment.count({ where: { customerId: newer.id } });
    expect(statusChanges + assignments).toBeGreaterThan(0);
    const auditBefore = await prisma.auditEvent.count({ where: { entityId: newer.id } });

    await merge(manager, older.id, newer.id);

    expect(await prisma.leadStatusChange.count({ where: { customerId: newer.id } })).toBe(0);
    expect(await prisma.leadAssignment.count({ where: { customerId: newer.id } })).toBe(0);
    expect(await prisma.leadStatusChange.count({ where: { customerId: older.id } })).toBeGreaterThanOrEqual(
      statusChanges,
    );
    expect(await prisma.leadAssignment.count({ where: { customerId: older.id } })).toBeGreaterThanOrEqual(assignments);
    expect(await prisma.leadInquiry.count({ where: { personId: newer.id } })).toBe(0);
    expect(await prisma.leadInquiry.count({ where: { personId: older.id } })).toBe(1);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ entityId: older.id });
    // The same template is never open twice: the merged record keeps no open step.
    expect(await prisma.leadStep.count({ where: { customerId: newer.id, doneAt: null } })).toBe(0);
    const open = await prisma.leadStep.groupBy({
      by: ["templateId"],
      where: { customerId: older.id, doneAt: null },
      _count: true,
    });
    expect(open.every((group) => group._count === 1)).toBe(true);
    // Notifications about the merged lead lead to the survivor; the audit history is not rewritten.
    expect(await prisma.notification.count({ where: { link: { contains: newer.id } } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: newer.id } })).toBeGreaterThanOrEqual(auditBefore);
    expect(await prisma.auditEvent.count({ where: { entityId: newer.id, action: "lead.created" } })).toBe(1);
  });

  it("fills only the survivor's empty fields and never overwrites; a different phone is recorded, not kept", async () => {
    const { manager, older, newer } = await twoLeads();

    await merge(manager, older.id, newer.id);

    const kept = await getLead(manager, older.id);
    // Filled from the merged record: email and birth date the survivor lacked.
    expect(kept).toMatchObject({ email: "an@example.com", gender: "MALE" });
    expect(kept.birthDate).toEqual(new Date(Date.UTC(1990, 2, 15)));
    // Kept: its own channel, need group, and phone.
    expect(kept).toMatchObject({ channel: { id: WHATSAPP }, needGroup: { id: PAIN_RELIEF }, phone: "0911000111" });
    const row = await prisma.personMerge.findUniqueOrThrow({ where: { mergedId: newer.id } });
    expect(JSON.stringify(row.before)).toContain("0911000222");
    expect(JSON.stringify(row.before)).toContain("conflicts");
  });

  it("gives the survivor the merged record's phone when it has none, so the phone stays with one record", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const quiet = await newLead(reception, "Không số", { phone: "" });
    const phone = uniquePhone();
    const withPhone = await newLead(reception, "Có số", { phone });
    await makeOlder(quiet.id);

    const result = await merge(manager, withPhone.id, quiet.id);

    expect(result.survivorId).toBe(quiet.id);
    expect(await prisma.customer.findMany({ where: { phone }, select: { id: true } })).toEqual([{ id: quiet.id }]);
    await expect(createLead(manager, { fullName: "Lại", phone, channelId: ZALO })).rejects.toMatchObject({
      code: "DUPLICATE_PHONE",
      duplicate: { id: quiet.id },
    });
    const duplicates = await prisma.$queryRaw<{ phone: string }[]>`
      SELECT "phone" FROM "customers" WHERE "phone" IS NOT NULL GROUP BY "phone" HAVING COUNT(*) > 1`;
    expect(duplicates).toEqual([]);
  });

  it("makes the customer survive a lead, even a newer one, and keeps its code", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(reception, { fullName: "Khách hàng An", phone: uniquePhone() });
    const lead = await newLead(reception, "Lead An", { phone: uniquePhone(), email: "lead@example.com" });
    await makeOlder(lead.id);

    const result = await merge(manager, lead.id, customer.id);

    expect(result).toEqual({ survivorId: customer.id, mergedId: lead.id, stage: "CUSTOMER" });
    expect(await getCustomer(manager, customer.id)).toMatchObject({
      customerCode: customer.customerCode,
      email: "lead@example.com",
    });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      mergedIntoId: customer.id,
      leadCode: lead.leadCode,
    });
    expect(await prisma.trashEntry.count({ where: { entityType: "person", entityId: lead.id } })).toBe(1);
    expect((await listCustomers(manager, {})).items.map((c) => c.id)).toEqual([customer.id]);
    // Same answer the other way round.
    const another = await newLead(reception, "Lead khác");
    expect(await merge(manager, customer.id, another.id)).toMatchObject({
      survivorId: customer.id,
      mergedId: another.id,
    });
  });

  it("refuses two customers (OQ-033) and changes nothing", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const one = await createCustomer(reception, { fullName: "Một", phone: uniquePhone() });
    const two = await createCustomer(reception, { fullName: "Hai", phone: uniquePhone() });

    await expect(merge(manager, one.id, two.id)).rejects.toMatchObject({ code: "MERGE_CUSTOMERS_UNSUPPORTED" });

    expect(await prisma.personMerge.count()).toBe(0);
    expect(await prisma.trashEntry.count({ where: { entityType: "person" } })).toBe(0);
    expect(await prisma.customer.count({ where: { mergedIntoId: { not: null } } })).toBe(0);
  });

  it("refuses a record merged with itself, a missing reason, and a bad id", async () => {
    const { manager, older, newer } = await twoLeads();
    const reasonId = await mergeReason();
    const other = await optionId("deleteReasons", "Khác");

    await expect(
      mergePersons(manager, older.id, { mergedId: older.id, reasonId, reasonNote: "" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(mergePersons(manager, older.id, { mergedId: newer.id, reasonNote: "" })).rejects.toMatchObject({
      fieldErrors: { reasonId: ["required"] },
    });
    await expect(
      mergePersons(manager, older.id, { mergedId: newer.id, reasonId: other, reasonNote: "" }),
    ).rejects.toMatchObject({
      fieldErrors: { reasonNote: ["otherNeedsNote"] },
    });
    await expect(mergePersons(manager, older.id, { mergedId: newer.id, reasonId: WHATSAPP })).rejects.toMatchObject({
      fieldErrors: { reasonId: ["invalidChoice"] },
    });
    await expect(mergePersons(manager, older.id, { mergedId: "nope", reasonId })).rejects.toMatchObject({
      fieldErrors: { mergedId: ["required"] },
    });
    await expect(
      mergePersons(manager, older.id, { mergedId: newer.id, reasonId: other, reasonNote: "a\u0000b" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      mergePersons(manager, older.id, { mergedId: "11111111-1111-4111-8111-111111111111", reasonId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mergePersons(manager, "not-a-uuid", { mergedId: newer.id, reasonId })).rejects.toMatchObject({
      code: expect.stringMatching(/^(NOT_FOUND|VALIDATION_FAILED)$/),
    });
    expect(await prisma.personMerge.count()).toBe(0);
  });

  it("accepts Khác with a note", async () => {
    const { manager, older, newer } = await twoLeads();
    const other = await optionId("deleteReasons", "Khác");

    await mergePersons(manager, older.id, { mergedId: newer.id, reasonId: other, reasonNote: "Cùng một người" });

    expect(await prisma.personMerge.findUniqueOrThrow({ where: { mergedId: newer.id } })).toMatchObject({
      reasonId: other,
      reasonNote: "Cùng một người",
    });
  });

  it("writes audit events with before and after, and tells the survivor's person in charge", async () => {
    const { manager, consultant, older, newer } = await twoLeads();

    await merge(manager, older.id, newer.id, "");

    const events = await prisma.auditEvent.findMany({
      where: { entityType: "person", entityId: { in: [older.id, newer.id] } },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((event) => event.actorUserId === manager.id)).toBe(true);
    expect(events.some((event) => event.before !== null && event.after !== null)).toBe(true);
    expect(await prisma.notification.count({ where: { userId: consultant.id, kind: "personMerged" } })).toBeGreaterThan(
      0,
    );
  });

  it("does not put encrypted values in the merge history, and copies an ID document as ciphertext only to a survivor without one", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const survivor = await newLead(reception, "Giữ lại");
    const merged = await newLead(reception, "Bị gộp");
    await makeOlder(survivor.id);
    await prisma.$executeRaw`UPDATE "customers" SET "health_note" = 'v1:abc', "id_document_type" = 'CCCD',
      "id_document_number" = 'v1:def', "data_consent_at" = now() WHERE "id" = ${merged.id}::uuid`;

    await merge(manager, survivor.id, merged.id);

    const [row] = await prisma.$queryRaw<
      { id_document_number: string | null; health_note: string | null; id_document_type: string | null }[]
    >`
      SELECT "id_document_number", "health_note", "id_document_type" FROM "customers" WHERE "id" = ${survivor.id}::uuid`;
    expect(row).toEqual({ id_document_number: "v1:def", health_note: "v1:abc", id_document_type: "CCCD" });
    const history = await prisma.personMerge.findUniqueOrThrow({ where: { mergedId: merged.id } });
    expect(JSON.stringify(history.before)).not.toContain("v1:");
  });

  it("acts once when the same pair is merged twice at the same time, in either order", async () => {
    const { manager, older, newer } = await twoLeads();

    const results = await Promise.allSettled([merge(manager, older.id, newer.id), merge(manager, newer.id, older.id)]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "PERSON_ALREADY_MERGED" } });
    expect(await prisma.personMerge.count()).toBe(1);
    expect(await prisma.trashEntry.count({ where: { entityType: "person" } })).toBe(1);
    expect(await prisma.leadInquiry.count()).toBe(0);
  });

  it("acts once when five requests merge the same pair", async () => {
    const { manager, older, newer } = await twoLeads();

    const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => merge(manager, older.id, newer.id)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.personMerge.count()).toBe(1);
  });

  it("refuses a second merge of the same pair and any merge that involves an already merged record", async () => {
    const { manager, reception, older, newer } = await twoLeads();
    const third = await newLead(reception, "Bản thứ ba");
    await merge(manager, older.id, newer.id);

    await expect(merge(manager, older.id, newer.id)).rejects.toMatchObject({ code: "PERSON_ALREADY_MERGED" });
    await expect(merge(manager, newer.id, older.id)).rejects.toMatchObject({ code: "PERSON_ALREADY_MERGED" });
    await expect(merge(manager, third.id, newer.id)).rejects.toMatchObject({ code: "PERSON_ALREADY_MERGED" });
    await expect(merge(manager, newer.id, third.id)).rejects.toMatchObject({ code: "PERSON_ALREADY_MERGED" });
    expect(await prisma.personMerge.count()).toBe(1);
    // The survivor can still be merged with a third record.
    expect(await merge(manager, older.id, third.id)).toMatchObject({ survivorId: older.id });
  });

  it("is rolled back whole when it fails", async () => {
    const { manager, older, newer } = await twoLeads();
    const missing = "11111111-1111-4111-8111-111111111111";

    await expect(mergePersons(manager, older.id, { mergedId: newer.id, reasonId: missing })).rejects.toBeDefined();

    expect(await prisma.customer.findUniqueOrThrow({ where: { id: newer.id } })).toMatchObject({
      mergedIntoId: null,
      phone: "0911000222",
    });
    expect(await prisma.trashEntry.count({ where: { entityType: "person" } })).toBe(0);
  });

  it("keeps a lead's work in order: a done step of the merged record is not lost", async () => {
    const { manager, consultant, older, newer } = await twoLeads();
    const open = (await leadChecklist(consultant, newer.id)).items.find((item) => item.state === "OPEN");
    expect(open).toBeDefined();
    await completeLeadStep(consultant, newer.id, open!.id, { resultIndex: 0 });
    const doneBefore = await prisma.leadStep.count({ where: { customerId: newer.id, doneAt: { not: null } } });

    await merge(manager, older.id, newer.id);

    const done = await prisma.leadStep.count({
      where: { customerId: { in: [older.id, newer.id] }, doneAt: { not: null } },
    });
    expect(done).toBeGreaterThanOrEqual(doneBefore);
    expect(await prisma.leadStep.count({ where: { customerId: newer.id, doneAt: null } })).toBe(0);
  });
});

describe("who may merge (A-065)", () => {
  async function pair() {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: consultant } = await createTestUser("CONSULTING");
    const one = await newLead(reception, "Một");
    const two = await newLead(reception, "Hai");
    return { reception, consultant, one, two };
  }

  it("needs lead.merge: consultants, reception, and PT cannot; manager and admin can", async () => {
    const { reception, consultant, one, two } = await pair();
    const { actor: pt } = await createTestUser("PT");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");

    for (const actor of [reception, consultant, pt]) {
      await expect(merge(actor, one.id, two.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await prisma.personMerge.count()).toBe(0);
    const first = await merge(manager, one.id, two.id);
    expect(first.stage).toBe("LEAD");
    const three = await newLead(admin, "Ba");
    await expect(merge(admin, first.survivorId, three.id)).resolves.toMatchObject({ stage: "LEAD" });
  });

  it("does not reveal a record outside the user's branches or lead scope", async () => {
    const { one, two } = await pair();
    const elsewhere = await createTestBranch();
    const { actor: remote } = await createTestUser("FITNESS_MANAGER", { branchIds: [elsewhere.id] });

    await expect(merge(remote, one.id, two.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.personMerge.count()).toBe(0);
  });

  it("across two branches needs both; the survivor's branch is kept", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const elsewhere = await createTestBranch();
    const { actor: remoteManager } = await createTestUser("FITNESS_MANAGER", { branchIds: [elsewhere.id] });
    const here = await newLead(admin, "Ở đây", { branchId: DEFAULT_BRANCH_ID });
    const there = await createLead(admin, { fullName: "Ở kia", channelId: WHATSAPP, branchId: elsewhere.id });
    await makeOlder(there.id);

    await expect(merge(manager, here.id, there.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(merge(remoteManager, here.id, there.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.personMerge.count()).toBe(0);

    const result = await merge(admin, here.id, there.id);
    expect(result.survivorId).toBe(there.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: there.id } })).branchId).toBe(elsewhere.id);
  });

  it("never lets a consultant with own scope see or merge another's lead", async () => {
    const { consultant, one, two } = await pair();
    const { actor: stranger } = await createTestUser("CONSULTING");
    await assignLead((await createTestUser("FITNESS_MANAGER")).actor, two.id, { userId: stranger.id });

    await expect(merge(consultant, one.id, two.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(merge(stranger, one.id, two.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
