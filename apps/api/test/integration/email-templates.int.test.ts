import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_EVENT_KEYS, EMAIL_TEMPLATE_DEFAULTS } from "@gymcrm/shared/mail";
import { prisma } from "../../src/platform/db/prisma.js";
import { markNoShow } from "../../src/modules/bookings/booking.service.js";
import { enrollCustomer, listClassSessions, markAttendance } from "../../src/modules/classes/class.service.js";
import { getTemplate, listTemplates, updateTemplate } from "../../src/modules/mail/template.service.js";
import { completeSession } from "../../src/modules/sessions/session.service.js";
import { burnShow, deleteTrainedSession } from "../../src/modules/sessions/session-history.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, withoutApprovals, type RoleCode } from "../support/factories.js";
import { book, bookingScenario } from "../support/bookings.js";
import { classCustomer, everyDayClass, gymTodayText } from "../support/classes.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

// Email templates and the customer emails of session changes (M6.2; brief §8.3; D-036, D-059; FR-MAIL-001, FR-MAIL-002;
// AC-17; A-177 to A-180).

const OTHER_DELETE = await optionId("deleteReasons", "Khác");
const BURN_REASON = await optionId("burnShowReasons", "Khôi phục buổi tập xóa nhầm");

const emails = (customerId: string, event?: string) =>
  prisma.emailMessage.findMany({
    where: { personId: customerId, ...(event ? { event } : {}) },
    orderBy: { createdAt: "asc" },
  });

async function trained() {
  const scenario = await bookingScenario();
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const booking = await book(scenario.manager, scenario, { date: "10/10/2026", startTime: "18:00", endTime: "19:00" });
  return { ...scenario, admin, booking };
}

describe("a session credited tells the customer, once (D-036, AC-17)", () => {
  it("Đã tập emails the sessions used and left, in Vietnamese by default", async () => {
    const { admin, booking, customer, contract } = await trained();

    await completeSession(admin, booking.id);

    const [email, ...rest] = await emails(customer.id, "session.credited");
    expect(rest).toHaveLength(0);
    expect(email).toMatchObject({ dedupeKey: `session.credited:${booking.id}`, locale: "vi" });
    expect(email?.subject).toBe(`Đã ghi nhận 1 buổi tập, hợp đồng ${contract.contractCode}`);
    expect(email?.body).toContain("Chào Nguyễn Văn An");
    expect(email?.body).toContain("ngày 10/10/2026 lúc 18:00 với PT Minh");
    expect(email?.body).toContain("Số buổi đã dùng: 1. Số buổi còn lại: 23.");
  });

  it("is sent once however often or however many times at once the session is completed", async () => {
    const { admin, booking, customer } = await trained();

    await Promise.all([1, 2, 3, 4].map(() => completeSession(admin, booking.id)));
    await completeSession(admin, booking.id);

    expect(await emails(customer.id, "session.credited")).toHaveLength(1);
  });

  it("is in English for a customer of a foreign nationality group", async () => {
    const { admin, booking, customer } = await trained();
    await prisma.customer.update({ where: { id: customer.id }, data: { countryCode: "US" } });

    await completeSession(admin, booking.id);

    const [email] = await emails(customer.id, "session.credited");
    expect(email).toMatchObject({ locale: "en" });
    expect(email?.subject).toMatch(/^1 session recorded, contract HD/);
    expect(email?.body).toContain("Hello Nguyễn Văn An");
    expect(email?.body).toContain("Sessions left: 23.");
  });

  it("is in Vietnamese for a Vietnamese customer", async () => {
    const { admin, booking, customer } = await trained();
    await prisma.customer.update({ where: { id: customer.id }, data: { countryCode: "VN" } });

    await completeSession(admin, booking.id);

    expect((await emails(customer.id, "session.credited"))[0]).toMatchObject({ locale: "vi" });
  });

  it("a no-show that uses a session emails once; one that does not use a session emails nothing", async () => {
    const { manager, customer, trainer, contract } = await trained();
    const noShow = await book(manager, { customer, contract, trainer }, { date: "09/10/2026" });

    await markNoShow(manager, noShow.id);
    await markNoShow(manager, noShow.id);

    const [email, ...rest] = await emails(customer.id, "session.noShow");
    expect(rest).toHaveLength(0);
    expect(email?.subject).toContain("Buổi tập vắng được tính");
    expect(email?.body).toContain("Số buổi đã dùng: 1. Số buổi còn lại: 23.");

    // The rule is configuration (D-025): when no-show uses nothing, the customer has nothing to be told.
    await prisma.sessionStatus.update({ where: { code: "NO_SHOW" }, data: { consumes: false } });
    const free = await book(manager, { customer, contract, trainer }, { date: "08/10/2026" });
    await markNoShow(manager, free.id);
    expect(await emails(customer.id, "session.noShow")).toHaveLength(1);
  });

  it("Burn Show and a refund email the new balance, and the refund says why", async () => {
    const { admin, booking, customer, trainer, contract } = await trained();
    await completeSession(admin, booking.id);

    await burnShow(admin, {
      contractId: contract.id,
      trainerId: trainer.id,
      date: "09/10/2026",
      startTime: "09:00",
      endTime: "10:00",
      reasonId: BURN_REASON,
    });
    await deleteTrainedSession(admin, booking.id, { reasonId: OTHER_DELETE, reasonNote: "Ghi nhầm buổi tập" });

    const [added] = await emails(customer.id, "session.added");
    expect(added?.body).toContain("Số buổi đã dùng: 2. Số buổi còn lại: 22.");
    const [refunded, ...rest] = await emails(customer.id, "session.refunded");
    expect(rest).toHaveLength(0);
    expect(refunded?.body).toContain("Lý do: Ghi nhầm buổi tập.");
    expect(refunded?.body).toContain("Số buổi còn lại: 23.");
  });

  it("a class session marked present emails once; absent emails nothing", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { gymClass } = await everyDayClass(admin, manager, { name: "Yoga 00:01" });
    const mine = await classCustomer(manager);
    const other = await classCustomer(manager, { fullName: "Khách vắng" });
    const today = (await listClassSessions(admin, { date: gymTodayText(), days: 1 }))[0]!;
    await enrollCustomer(reception, today.id, { customerId: mine.customer.id, contractId: mine.contract.id });
    await enrollCustomer(reception, today.id, { customerId: other.customer.id, contractId: other.contract.id });
    const seatOf = (customerId: string) =>
      prisma.classAttendance.findFirstOrThrow({ where: { classSessionId: today.id, customerId } });

    const present = await seatOf(mine.customer.id);
    await markAttendance(admin, today.id, present.id, { status: "PRESENT" });
    await markAttendance(admin, today.id, present.id, { status: "PRESENT" });
    await markAttendance(admin, today.id, (await seatOf(other.customer.id)).id, { status: "ABSENT" });

    const [email, ...rest] = await emails(mine.customer.id, "class.attended");
    expect(rest).toHaveLength(0);
    expect(email?.subject).toContain(gymClass.name);
    expect(email?.body).toContain("Số buổi đã dùng: 1. Số buổi còn lại: 11.");
    expect(await emails(other.customer.id)).toHaveLength(0);
  });
});

describe("the templates admin edits (FR-MAIL-001)", () => {
  it("lists every event with its placeholders, still the system's own words until edited", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const { items } = await listTemplates(admin);

    expect(items.map((item) => item.event)).toEqual(EMAIL_EVENT_KEYS);
    const refund = items.find((item) => item.event === "session.refunded")!;
    expect(refund).toMatchObject({ mandatory: true, updatedAt: null, updatedBy: null });
    expect(refund.placeholders.filter((placeholder) => placeholder.required).map((p) => p.name)).toEqual([
      "remaining",
      "reason",
    ]);
    expect(refund.subjectVi).toBe(EMAIL_TEMPLATE_DEFAULTS["session.refunded"].subjectVi);
  });

  it("a saved text is what the next email says, per language, and the change is audited", async () => {
    const { admin, booking, customer, contract } = await trained();
    const before = await getTemplate(admin, "session.credited");

    const saved = await updateTemplate(admin, "session.credited", {
      subjectVi: "Buổi tập mới, HĐ {contractCode}",
      bodyVi: "Xin chào {customerName}. Còn {remaining} buổi (đã dùng {used}).",
      subjectEn: before.subjectEn,
      bodyEn: before.bodyEn,
    });
    await completeSession(admin, booking.id);

    expect(saved.updatedBy).not.toBeNull();
    expect(saved.updatedAt).not.toBeNull();
    const [email] = await emails(customer.id, "session.credited");
    expect(email).toMatchObject({
      subject: `Buổi tập mới, HĐ ${contract.contractCode}`,
      body: "Xin chào Nguyễn Văn An. Còn 23 buổi (đã dùng 1).",
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "email_template.updated" } });
    expect(audit).toMatchObject({ actorUserId: admin.id, entityType: "email_template" });
    expect(audit.before).toMatchObject({ subjectVi: before.subjectVi });
    expect(audit.after).toMatchObject({ subjectVi: "Buổi tập mới, HĐ {contractCode}" });
  });

  it("refuses a placeholder the event does not offer, a body that drops what must be told, and bad characters", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const base = EMAIL_TEMPLATE_DEFAULTS["session.refunded"];

    await expect(
      updateTemplate(admin, "session.refunded", { ...base, bodyVi: "Còn {remaining}. {className}" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { bodyVi: ["unknownPlaceholder", "missingPlaceholder"] },
    });
    await expect(
      updateTemplate(admin, "session.refunded", { ...base, bodyEn: "Left: {remaining}" }),
    ).rejects.toMatchObject({ fieldErrors: { bodyEn: ["missingPlaceholder"] } });
    await expect(
      updateTemplate(admin, "session.refunded", { ...base, subjectVi: "a\r\nBcc: x" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(updateTemplate(admin, "session.refunded", { ...base, bodyVi: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(updateTemplate(admin, "contract.upgraded", base)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getTemplate(admin, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getTemplate(admin, "session.refunded")).updatedAt).toBeNull();
  });

  it("is Admin's: nobody else lists, reads or edits the words customers are sent", async () => {
    for (const role of [
      "FITNESS_MANAGER",
      "RECEPTIONIST",
      "ACCOUNTANT",
      "PT",
      "CONSULTING",
      "MARKETING",
    ] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(listTemplates(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(getTemplate(actor, "session.credited")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        updateTemplate(actor, "session.credited", EMAIL_TEMPLATE_DEFAULTS["session.credited"]),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("still sends the system's words if a row is ever missing", async () => {
    const { admin, booking, customer } = await trained();
    await prisma.emailTemplate.delete({ where: { event: "session.credited" } });

    await completeSession(admin, booking.id);

    expect((await emails(customer.id, "session.credited"))[0]?.body).toContain("Số buổi còn lại: 23.");
    // The row is put back for the tests that follow (resetDatabase only rewrites rows that exist).
    await prisma.emailTemplate.create({
      data: { event: "session.credited", ...EMAIL_TEMPLATE_DEFAULTS["session.credited"] },
    });
  });
});
