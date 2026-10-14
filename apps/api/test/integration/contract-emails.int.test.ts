import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMAIL_EVENT_KEYS, EMAIL_EVENTS, EMAIL_TEMPLATE_DEFAULTS } from "@flow/shared/mail";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { env } from "../../src/platform/env.js";
import { prisma } from "../../src/platform/db/prisma.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { activateContract } from "../../src/modules/contracts/contract-approval.service.js";
import { emailContractNotices } from "../../src/modules/contracts/contract-email.js";
import { cancelContract, createContract } from "../../src/modules/contracts/contract.service.js";
import { deactivateContract, reactivateContract } from "../../src/modules/contracts/contract-freeze.service.js";
import { decidePayment, recordPayment } from "../../src/modules/finance/payment.service.js";
import { getTemplate, listTemplates, updateTemplate } from "../../src/modules/mail/template.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, optionId, uniquePhone, withoutApprovals } from "../support/factories.js";
import { activeContract, contractInput } from "../support/bookings.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

// The optional customer emails (M6.3; D-036, D-059; FR-MAIL-001; A-181, A-182) and their switch.

const CASH = await optionId("paymentMethods", "Tiền mặt");
const FREEZE = await optionId("freezeReasons", "Khác");
const UNFREEZE = await optionId("unfreezeReasons", "Khác");

const emails = (customerId: string, event?: string) =>
  prisma.emailMessage.findMany({
    where: { personId: customerId, ...(event ? { event } : {}) },
    orderBy: { createdAt: "asc" },
  });

async function setup(options: { email?: string | null; countryCode?: string; sessions?: number } = {}) {
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const customer = await createCustomer(manager, {
    fullName: "Nguyễn Văn An",
    phone: uniquePhone(),
    ...(options.email === null ? {} : { email: options.email ?? "an@example.com" }),
  });
  if (options.countryCode) {
    await prisma.customer.update({ where: { id: customer.id }, data: { countryCode: options.countryCode } });
  }
  const contract = await activeContract(manager, customer.id, { sessions: options.sessions ?? 24 });
  return { manager, admin, customer, contract };
}

const pay = (admin: Awaited<ReturnType<typeof setup>>["admin"], contractId: string, amount: number) =>
  recordPayment(admin, contractId, { amount, methodId: CASH, paidOn: "05/10/2026" }, randomUUID());

describe("the contract emails (D-059)", () => {
  it("activating a contract emails its dates and sessions once, in Vietnamese", async () => {
    const { customer, contract } = await setup();

    const [email, ...rest] = await emails(customer.id, "contract.activated");

    expect(rest).toHaveLength(0);
    expect(email).toMatchObject({ dedupeKey: `contract.activated:${contract.id}`, locale: "vi", status: "QUEUED" });
    expect(email?.subject).toBe(`Hợp đồng ${contract.contractCode} đã được kích hoạt`);
    expect(email?.body).toContain("Hiệu lực từ 01/10/2026 đến");
    expect(email?.body).toContain("tổng 24 buổi");
  });

  it("a renewal has its own words", async () => {
    const { manager, admin, customer, contract } = await setup();
    const input = await contractInput({ contractType: "RENEW", previousContractId: contract.id });
    const { contract: renewal } = await createContract(manager, customer.id, input, randomUUID());

    await activateContract(admin, renewal.id);

    const [email] = await emails(customer.id, "contract.renewed");
    expect(email?.subject).toBe(`Hợp đồng tái ký ${renewal.contractCode} đã được kích hoạt`);
    expect(await emails(customer.id, "contract.activated")).toHaveLength(1);
  });

  it("a receipt emails the amount, what is paid and what is still owed; in English for a foreign customer", async () => {
    const { admin, customer, contract } = await setup({ countryCode: "US" });

    const { payment } = await pay(admin, contract.id, 3_000_000);

    const [email, ...rest] = await emails(customer.id, "payment.received");
    expect(rest).toHaveLength(0);
    expect(email).toMatchObject({ dedupeKey: `payment.received:${payment.id}`, locale: "en" });
    expect(email?.subject).toBe(`Received VND 3,000,000, receipt ${payment.receiptNumber}`);
    expect(email?.body).toContain("Total paid: VND 3,000,000. Still owed: VND 9,000,000.");
  });

  it("a receipt waiting for approval emails nothing until it is approved, and then once (D-018)", async () => {
    const { admin, customer, contract } = await setup();
    await prisma.approvalRule.updateMany({ where: { actionType: "payment.create" }, data: { required: true } });

    const { payment } = await pay(admin, contract.id, 1_000_000);
    expect(await emails(customer.id, "payment.received")).toHaveLength(0);

    await prisma.$transaction((tx) => decidePayment(tx, admin, payment.id, "APPROVED"));
    expect(await emails(customer.id, "payment.received")).toHaveLength(1);

    const { payment: rejected } = await pay(admin, contract.id, 1_000_000);
    await prisma.$transaction((tx) => decidePayment(tx, admin, rejected.id, "REJECTED"));
    expect(await emails(customer.id, "payment.received")).toHaveLength(1);
  });

  it("putting a contract on hold, reactivating it with the new end date, and cancelling each email once", async () => {
    const { admin, customer, contract } = await setup();

    await deactivateContract(admin, contract.id, { reasonId: FREEZE, reasonNote: "Đi công tác" });
    await deactivateContract(admin, contract.id, { reasonId: FREEZE, reasonNote: "Đi công tác" });
    const reactivated = await reactivateContract(admin, contract.id, {
      reasonId: UNFREEZE,
      reasonNote: "Quay lại tập",
      extension: "CUSTOM",
      days: "10",
    });
    await cancelContract(admin, contract.id);
    await cancelContract(admin, contract.id);

    const [hold, ...holds] = await emails(customer.id, "contract.deactivated");
    expect(holds).toHaveLength(0);
    expect(hold?.body).toContain("Lý do: Đi công tác.");
    const [again, ...agains] = await emails(customer.id, "contract.reactivated");
    expect(agains).toHaveLength(0);
    expect(again?.body).toContain("Số ngày được cộng thêm: 10.");
    const end = reactivated.endDate.toISOString().slice(0, 10).split("-").reverse().join("/");
    expect(again?.subject).toContain(end);
    expect(await emails(customer.id, "contract.cancelled")).toHaveLength(1);
  });

  it("a customer with no email address gets no optional email, and no failed row or task for reception", async () => {
    const { admin, customer, contract } = await setup({ email: null });

    await pay(admin, contract.id, 1_000_000);

    expect(await emails(customer.id)).toHaveLength(0);
    expect(await prisma.task.count()).toBe(0);
  });
});

describe("the switch of an optional email (D-036)", () => {
  it("an event switched off sends nothing, and sends again when switched on; the words are kept", async () => {
    const { admin, customer, contract } = await setup();
    const template = await getTemplate(admin, "payment.received");
    const texts = {
      subjectVi: template.subjectVi,
      bodyVi: template.bodyVi,
      subjectEn: template.subjectEn,
      bodyEn: template.bodyEn,
    };

    const off = await updateTemplate(admin, "payment.received", { ...texts, enabled: false });
    await pay(admin, contract.id, 1_000_000);
    expect(off.enabled).toBe(false);
    expect(await emails(customer.id, "payment.received")).toHaveLength(0);

    // Saving the words without the switch leaves it as it was.
    expect((await updateTemplate(admin, "payment.received", texts)).enabled).toBe(false);
    const on = await updateTemplate(admin, "payment.received", { ...texts, enabled: true });
    await pay(admin, contract.id, 1_000_000);

    expect(on.enabled).toBe(true);
    expect(await emails(customer.id, "payment.received")).toHaveLength(1);
    const audit = await prisma.auditEvent.findMany({
      where: { action: "email_template.updated" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit[0]).toMatchObject({ before: { enabled: true }, after: { enabled: false } });
  });

  it("a mandatory email cannot be switched off", async () => {
    const { admin } = await setup();
    const texts = EMAIL_TEMPLATE_DEFAULTS["session.credited"];

    await expect(updateTemplate(admin, "session.credited", { ...texts, enabled: false })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { enabled: ["mandatoryEvent"] },
    });
    const listed = (await listTemplates(admin)).items.filter(
      (item) => EMAIL_EVENTS[item.event as keyof typeof EMAIL_EVENTS].mandatory,
    );
    expect(listed.every((item) => item.enabled)).toBe(true);
  });

  it("lists the optional events with the switch on to begin with", async () => {
    const { admin } = await setup();

    const { items } = await listTemplates(admin);

    expect(items.map((item) => item.event)).toEqual(EMAIL_EVENT_KEYS);
    const optional = items.filter((item) => !item.mandatory);
    expect(optional).toHaveLength(9);
    expect(optional.every((item) => item.enabled && item.updatedAt === null)).toBe(true);
  });
});

describe("a contract ending or running out of sessions (D-012, A-023, A-025)", () => {
  it("emails the end date once, and not for a contract that ends later", async () => {
    const { admin, customer, contract } = await setup();
    const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
    await prisma.contract.update({
      where: { id: contract.id },
      data: { endDate: new Date(today.getTime() + 10 * 86_400_000) },
    });
    const far = await setup();

    await emailContractNotices();
    await emailContractNotices();

    const [email, ...rest] = await emails(customer.id, "contract.expiring");
    expect(rest).toHaveLength(0);
    expect(email?.body).toContain("còn 10 ngày");
    expect(await emails(far.customer.id, "contract.expiring")).toHaveLength(0);
    expect(admin).toBeDefined();
  });

  it("emails a contract with few sessions left once, and nothing while the event is off", async () => {
    const { admin, customer } = await setup({ sessions: 3 });
    const texts = EMAIL_TEMPLATE_DEFAULTS["contract.runningOut"];
    await updateTemplate(admin, "contract.runningOut", { ...texts, enabled: false });

    await emailContractNotices();
    expect(await emails(customer.id, "contract.runningOut")).toHaveLength(0);

    await updateTemplate(admin, "contract.runningOut", { ...texts, enabled: true });
    await emailContractNotices();
    await emailContractNotices();

    const [email, ...rest] = await emails(customer.id, "contract.runningOut");
    expect(rest).toHaveLength(0);
    expect(email?.body).toContain("chỉ còn 3 buổi");
  });
});
