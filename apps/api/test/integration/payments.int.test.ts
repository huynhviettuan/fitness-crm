import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { cancelContract, createContract, getContract, listContracts } from "../../src/modules/contracts/contract.service.js";
import { collectedBetween, listDebts, listPayments, recordPayment, voidPayment } from "../../src/modules/finance/payment.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser } from "../support/factories.js";
import { activeContract, CONTRACT } from "../support/bookings.js";

afterEach(async () => {
  vi.useRealTimers();
  await resetDatabase();
});

/** A receptionist, who records payments, and a 12,000,000 contract a Fitness Manager sold. */
async function setup() {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const contract = await activeContract(manager, customer.id);
  return { reception, manager, customer, contract };
}

const pay = (actor: Actor, contractId: string, amount: string | number, key = randomUUID(), paidOn = "05/10/2026") =>
  recordPayment(actor, contractId, { amount, method: "CASH", paidOn }, key);

describe("recordPayment", () => {
  it("confirms the payment, updates paid and debt (E2E-008 figures), and audits", async () => {
    const { reception, contract } = await setup();

    const { payment, replayed } = await pay(reception, contract.id, "5.000.000");
    await pay(reception, contract.id, 3_000_000);

    expect(replayed).toBe(false);
    expect(payment).toMatchObject({ status: "CONFIRMED", amount: 5_000_000, method: "CASH", createdBy: "RECEPTIONIST test user" });
    expect(await getContract(reception, contract.id)).toMatchObject({ confirmedPaidAmount: 8_000_000, paidAmount: 8_000_000, debt: 4_000_000 });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: payment.id } });
    expect(audit).toMatchObject({ action: "payment.created", metadata: { amount: 5_000_000, paidOn: "2026-10-05" } });
  });

  it("needs an idempotency key", async () => {
    const { reception, contract } = await setup();

    await expect(recordPayment(reception, contract.id, { amount: 1, method: "CASH", paidOn: "05/10/2026" }, undefined)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  it("the same submission twice records one payment (INT-004)", async () => {
    const { reception, contract } = await setup();
    const key = randomUUID();

    const first = await pay(reception, contract.id, 5_000_000, key);
    const second = await pay(reception, contract.id, "5.000.000", key);

    expect(second).toEqual({ payment: first.payment, replayed: true });
    expect((await getContract(reception, contract.id)).confirmedPaidAmount).toBe(5_000_000);
  });

  it("the same key with a different amount is refused and records nothing (INT-005)", async () => {
    const { reception, contract } = await setup();
    const key = randomUUID();
    await pay(reception, contract.id, 5_000_000, key);

    await expect(pay(reception, contract.id, 6_000_000, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(await prisma.payment.count()).toBe(1);
  });

  it("a double-click (same key at the same time) records one payment, even near the contract value", async () => {
    const { reception, contract } = await setup();
    const key = randomUUID();

    const results = await Promise.all(Array.from({ length: 5 }, () => pay(reception, contract.id, 8_000_000, key)));

    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await getContract(reception, contract.id)).confirmedPaidAmount).toBe(8_000_000);
  });

  it("refuses a payment above the remaining value, including opening balances (OQ-003 interim, D-011)", async () => {
    const { reception, contract } = await setup();
    await prisma.contract.update({ where: { id: contract.id }, data: { openingPaidAmount: 4_000_000 } });
    await pay(reception, contract.id, 7_000_000);

    await expect(pay(reception, contract.id, 1_000_001)).rejects.toMatchObject({ code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" });
    await expect(pay(reception, contract.id, 1_000_000)).resolves.toBeDefined();
    expect(await getContract(reception, contract.id)).toMatchObject({ paidAmount: 12_000_000, debt: 0 });
  });

  it("two different payments racing for the last of the contract value: one is recorded", async () => {
    const { reception, contract } = await setup();
    await pay(reception, contract.id, 10_000_000);

    const results = await Promise.allSettled([pay(reception, contract.id, 2_000_000), pay(reception, contract.id, 2_000_000)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" } });
    expect((await getContract(reception, contract.id)).debt).toBe(0);
  });

  it("accepts draft and expired contracts, but not cancelled ones (OQ-013 interim)", async () => {
    const { reception, manager, customer, contract } = await setup();
    const { contract: draft } = await createContract(manager, customer.id, CONTRACT, randomUUID());
    await cancelContract(manager, contract.id);

    await expect(pay(reception, draft.id, 1_000_000)).resolves.toBeDefined();
    await expect(pay(reception, contract.id, 1_000_000)).rejects.toMatchObject({ code: "PAYMENT_CONTRACT_CANCELLED" });
  });

  it("returns field errors for invalid input, and refuses a day after today", async () => {
    const { reception, contract } = await setup();
    const fields = async (input: object) =>
      recordPayment(reception, contract.id, input, randomUUID()).catch((error: { code: string; fieldErrors: object }) => error);

    expect(await fields({ amount: "0", method: "GOLD", paidOn: "31/02/2026" })).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { amount: ["amountNotPositive"], method: ["invalidChoice"], paidOn: ["invalidDate"] },
    });
    expect(await fields({ amount: "-5", method: "CASH", paidOn: "05/10/2026" })).toMatchObject({ fieldErrors: { amount: ["invalidAmount"] } });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T16:59:00Z")); // 23:59 on 10/10 in the gym
    expect(await fields({ amount: 1, method: "CASH", paidOn: "11/10/2026" })).toMatchObject({ fieldErrors: { paidOn: ["futureDate"] } });
    vi.useRealTimers();
    expect(await prisma.payment.count()).toBe(0);
  });

  it.each(["PT"] as const)("refuses a %s (docs/09)", async (role) => {
    const { contract } = await setup();
    const { actor } = await createTestUser(role);

    await expect(pay(actor, contract.id, 1_000_000)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an unknown contract is NOT_FOUND", async () => {
    const { reception } = await setup();

    await expect(pay(reception, randomUUID(), 1_000_000)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("voidPayment (A-008)", () => {
  it("needs a reason, removes the payment from the paid amount, and keeps it on record", async () => {
    const { reception, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await expect(voidPayment(accountant, payment.id, { reason: "  " })).rejects.toMatchObject({ fieldErrors: { reason: ["required"] } });
    const voided = await voidPayment(accountant, payment.id, { reason: "Ghi nhầm hợp đồng" });

    expect(voided).toMatchObject({ status: "VOIDED", voidReason: "Ghi nhầm hợp đồng", voidedBy: "ACCOUNTANT test user", amount: 5_000_000 });
    expect(await getContract(reception, contract.id)).toMatchObject({ paidAmount: 0, debt: 12_000_000 });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: payment.id, action: "payment.voided" } })).toMatchObject({
      metadata: { reason: "Ghi nhầm hợp đồng", amount: 5_000_000 },
    });
  });

  it("a repeat returns the current state and keeps the first reason", async () => {
    const { reception, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await voidPayment(accountant, payment.id, { reason: "Lần một" });
    const again = await voidPayment(accountant, payment.id, { reason: "Lần hai" });

    expect(again).toMatchObject({ status: "VOIDED", voidReason: "Lần một" });
    expect(await prisma.auditEvent.count({ where: { entityId: payment.id, action: "payment.voided" } })).toBe(1);
  });

  // 09_RBAC.md: deleting vouchers is Admin's (and the custom Kế toán role's).
  it.each(["RECEPTIONIST", "PT", "FITNESS_MANAGER"] as const)("refuses a %s (docs/09)", async (role) => {
    const { reception, contract } = await setup();
    const { actor } = await createTestUser(role);
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await expect(voidPayment(actor, payment.id, { reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the database refuses a voided payment without its reason, and a non-positive amount", async () => {
    const { reception, contract } = await setup();
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await expect(prisma.payment.update({ where: { id: payment.id }, data: { status: "VOIDED" } })).rejects.toThrow(/payments_void_complete/);
    await expect(prisma.payment.update({ where: { id: payment.id }, data: { amount: 0 } })).rejects.toThrow(/payments_amount_positive/);
  });
});

describe("reading", () => {
  it("lists payments by contract, customer, status, and day; totals what was collected", async () => {
    const { reception, customer, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const a = await pay(reception, contract.id, 1_000_000, randomUUID(), "01/10/2026");
    const b = await pay(reception, contract.id, 2_000_000, randomUUID(), "05/10/2026");
    await voidPayment(accountant, a.payment.id, { reason: "Sai" });

    expect((await listPayments(reception, { customerId: customer.id })).items.map((p) => p.id)).toEqual([b.payment.id, a.payment.id]);
    expect((await listPayments(reception, { status: "VOIDED" })).items.map((p) => p.id)).toEqual([a.payment.id]);
    expect((await listPayments(reception, { from: "02/10/2026", to: "31/10/2026" })).total).toBe(1);
    expect(await collectedBetween(reception, { from: "01/10/2026", to: "31/10/2026" })).toBe(2_000_000);
  });

  it("the debt list shows owing contracts, largest first, without drafts (A-022)", async () => {
    const { reception, manager, customer, contract } = await setup();
    const small = await activeContract(manager, customer.id, { contractValue: "2.000.000" });
    const paidUp = await activeContract(manager, customer.id, { contractValue: "1.000.000" });
    await createContract(manager, customer.id, CONTRACT, randomUUID()); // draft
    await pay(reception, paidUp.id, 1_000_000);

    const debts = await listDebts(reception, {});

    expect(debts.items.map((c) => [c.id, c.debt])).toEqual([
      [contract.id, 12_000_000],
      [small.id, 2_000_000],
    ]);
    expect(debts.total).toBe(2);
  });

  it("a trainer cannot list payments or debts", async () => {
    const { actor: trainer } = await createTestUser("PT");

    await expect(listPayments(trainer, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listDebts(trainer, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("contract lists carry each contract's own paid amount", async () => {
    const { reception, manager, customer, contract } = await setup();
    const other = await activeContract(manager, customer.id);
    await pay(reception, contract.id, 3_000_000);

    const items = (await listContracts(reception, { customerId: customer.id })).items;
    expect(Object.fromEntries(items.map((c) => [c.id, c.paidAmount]))).toEqual({ [contract.id]: 3_000_000, [other.id]: 0 });
  });
});
