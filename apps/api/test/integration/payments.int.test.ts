import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import {
  cancelContract,
  createContract,
  getContract,
  listContracts,
} from "../../src/modules/contracts/contract.service.js";
import {
  collectedBetween,
  deletePayment,
  listDebts,
  listPayments,
  recordPayment,
} from "../../src/modules/finance/payment.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestOption, createTestUser, optionId, withoutApprovals } from "../support/factories.js";
import { activeContract, contractInput } from "../support/bookings.js";

afterEach(async () => {
  vi.useRealTimers();
  await resetDatabase();
});
// These tests are about something else than approvals (approvals.int.test.ts).
beforeEach(async () => {
  await withoutApprovals();
});

// Seeded by the migration (D-016), so their ids stay the same between tests.
const CASH = await optionId("paymentMethods", "Tiền mặt");
const OTHER_METHOD = await optionId("paymentMethods", "Khác");
const OTHER_REASON = await optionId("deleteReasons", "Khác");

/** A receptionist, who records payments, and a 12,000,000 contract a Fitness Manager sold. */
async function setup() {
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
  const contract = await activeContract(manager, customer.id);
  return { reception, manager, customer, contract };
}

const pay = (actor: Actor, contractId: string, amount: string | number, key = randomUUID(), paidOn = "05/10/2026") =>
  recordPayment(actor, contractId, { amount, methodId: CASH, paidOn }, key);

describe("recordPayment", () => {
  it("confirms the payment, updates paid and debt (E2E-008 figures), and audits", async () => {
    const { reception, contract } = await setup();

    const { payment, replayed } = await pay(reception, contract.id, "5.000.000");
    await pay(reception, contract.id, 3_000_000);

    expect(replayed).toBe(false);
    expect(payment).toMatchObject({
      amount: 5_000_000,
      method: { id: CASH, labelVi: "Tiền mặt", note: null },
      createdBy: "RECEPTIONIST test user",
    });
    expect(await getContract(reception, contract.id)).toMatchObject({
      confirmedPaidAmount: 8_000_000,
      paidAmount: 8_000_000,
      debt: 4_000_000,
    });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: payment.id } });
    expect(audit).toMatchObject({ action: "payment.created", after: { amount: 5_000_000, paidOn: "2026-10-05" } });
  });

  it("needs an idempotency key", async () => {
    const { reception, contract } = await setup();

    await expect(
      recordPayment(reception, contract.id, { amount: 1, methodId: CASH, paidOn: "05/10/2026" }, undefined),
    ).rejects.toMatchObject({
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

    await expect(pay(reception, contract.id, 1_000_001)).rejects.toMatchObject({
      code: "PAYMENT_EXCEEDS_CONTRACT_VALUE",
    });
    await expect(pay(reception, contract.id, 1_000_000)).resolves.toBeDefined();
    expect(await getContract(reception, contract.id)).toMatchObject({ paidAmount: 12_000_000, debt: 0 });
  });

  it("two different payments racing for the last of the contract value: one is recorded", async () => {
    const { reception, contract } = await setup();
    await pay(reception, contract.id, 10_000_000);

    const results = await Promise.allSettled([
      pay(reception, contract.id, 2_000_000),
      pay(reception, contract.id, 2_000_000),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "PAYMENT_EXCEEDS_CONTRACT_VALUE" },
    });
    expect((await getContract(reception, contract.id)).debt).toBe(0);
  });

  it("accepts draft and expired contracts, but not cancelled ones (OQ-013 interim)", async () => {
    const { reception, manager, customer, contract } = await setup();
    const { contract: draft } = await createContract(manager, customer.id, await contractInput(), randomUUID());
    await cancelContract(manager, contract.id);

    await expect(pay(reception, draft.id, 1_000_000)).resolves.toBeDefined();
    await expect(pay(reception, contract.id, 1_000_000)).rejects.toMatchObject({ code: "PAYMENT_CONTRACT_CANCELLED" });
  });

  it("returns field errors for invalid input, and refuses a day after today", async () => {
    const { reception, contract } = await setup();
    const fields = async (input: object) =>
      recordPayment(reception, contract.id, input, randomUUID()).catch(
        (error: { code: string; fieldErrors: object }) => error,
      );

    expect(await fields({ amount: "0", methodId: "GOLD", paidOn: "31/02/2026" })).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { amount: ["amountNotPositive"], methodId: ["required"], paidOn: ["invalidDate"] },
    });
    expect(await fields({ amount: "-5", methodId: CASH, paidOn: "05/10/2026" })).toMatchObject({
      fieldErrors: { amount: ["invalidAmount"] },
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T16:59:00Z")); // 23:59 on 10/10 in the gym
    expect(await fields({ amount: 1, methodId: CASH, paidOn: "11/10/2026" })).toMatchObject({
      fieldErrors: { paidOn: ["futureDate"] },
    });
    vi.useRealTimers();
    expect(await prisma.payment.count()).toBe(0);
  });

  it("takes the method from the list: active, of this list, and Khác only with a note (D-016, AC-04)", async () => {
    const { reception, contract } = await setup();
    const fields = async (input: object) =>
      recordPayment(reception, contract.id, { amount: 1, paidOn: "05/10/2026", ...input }, randomUUID()).catch(
        (error: { code: string; fieldErrors: object }) => error,
      );

    expect(await fields({ methodId: OTHER_METHOD, methodNote: "  " })).toMatchObject({
      fieldErrors: { methodNote: ["otherNeedsNote"] },
    });
    expect(await fields({ methodId: await optionId("paymentMethods", "Ví điện tử") })).toMatchObject({
      fieldErrors: { methodId: ["invalidChoice"] },
    });
    expect(await fields({ methodId: OTHER_REASON })).toMatchObject({ fieldErrors: { methodId: ["invalidChoice"] } });
    expect(await fields({ methodId: randomUUID() })).toMatchObject({ fieldErrors: { methodId: ["invalidChoice"] } });
    expect(await prisma.payment.count()).toBe(0);

    const { payment } = await recordPayment(
      reception,
      contract.id,
      { amount: 1, methodId: OTHER_METHOD, methodNote: "Ví MoMo", paidOn: "05/10/2026" },
      randomUUID(),
    );
    expect(payment.method).toEqual({
      id: OTHER_METHOD,
      labelVi: "Khác",
      labelEn: "Other",
      code: null,
      isOther: true,
      note: "Ví MoMo",
    });
  });

  it("an option made inactive later stays on the payments that have it (D-016, AC-03)", async () => {
    const { reception, contract } = await setup();
    const momo = await createTestOption("paymentMethods", "Ví MoMo");
    const { payment } = await recordPayment(
      reception,
      contract.id,
      { amount: 1, methodId: momo, paidOn: "05/10/2026" },
      randomUUID(),
    );

    await prisma.option.update({ where: { id: momo }, data: { active: false } });

    expect((await listPayments(reception, { contractId: contract.id })).items[0]).toMatchObject({
      id: payment.id,
      method: { id: momo, labelVi: "Ví MoMo" },
    });
    await expect(
      recordPayment(reception, contract.id, { amount: 1, methodId: momo, paidOn: "05/10/2026" }, randomUUID()),
    ).rejects.toMatchObject({
      fieldErrors: { methodId: ["invalidChoice"] },
    });
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

describe("deletePayment (D-035)", () => {
  it("needs a reason from the list, then leaves lists and the paid amount and goes to the trash", async () => {
    const { reception, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await expect(deletePayment(accountant, payment.id, { reasonId: "" })).rejects.toMatchObject({
      fieldErrors: { reasonId: ["required"] },
    });
    await expect(
      deletePayment(accountant, payment.id, { reasonId: OTHER_REASON, reasonNote: " " }),
    ).rejects.toMatchObject({
      fieldErrors: { reasonNote: ["otherNeedsNote"] },
    });
    await deletePayment(accountant, payment.id, { reasonId: OTHER_REASON, reasonNote: "Ghi nhầm hợp đồng" });

    expect(await getContract(reception, contract.id)).toMatchObject({ paidAmount: 0, debt: 12_000_000 });
    expect((await listPayments(reception, { contractId: contract.id })).total).toBe(0);
    expect(await prisma.trashEntry.findFirst({ where: { entityId: payment.id } })).toMatchObject({
      entityType: "payment",
      title: `${payment.receiptNumber} · ${contract.contractCode} · Nguyễn Văn An`,
      reasonId: OTHER_REASON,
      reasonNote: "Ghi nhầm hợp đồng",
      deletedById: accountant.id,
      snapshot: {
        id: payment.id,
        amount: 5_000_000,
        paidOn: "2026-10-05T00:00:00.000Z",
        createdBy: "RECEPTIONIST test user",
      },
    });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityId: payment.id, action: "payment.deleted" } }),
    ).toMatchObject({
      before: { id: payment.id, amount: 5_000_000 },
      after: null,
      metadata: { reason: { optionId: OTHER_REASON, note: "Ghi nhầm hợp đồng" } },
    });
  });

  it("a deleted payment is gone: deleting again, even at once, is NOT_FOUND and leaves one trash entry", async () => {
    const { reception, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { payment } = await pay(reception, contract.id, 5_000_000);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        deletePayment(accountant, payment.id, { reasonId: OTHER_REASON, reasonNote: "Trùng" }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(
      ["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"],
    );
    expect(await prisma.trashEntry.count({ where: { entityId: payment.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: payment.id, action: "payment.deleted" } })).toBe(1);
  });

  // 09_RBAC.md: deleting vouchers is Admin's (and the custom Kế toán role's).
  it.each(["RECEPTIONIST", "PT", "FITNESS_MANAGER"] as const)("refuses a %s (docs/09)", async (role) => {
    const { reception, contract } = await setup();
    const { actor } = await createTestUser(role);
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await expect(deletePayment(actor, payment.id, { reasonId: OTHER_REASON, reasonNote: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("the database refuses a deletion without who and why, and a non-positive amount", async () => {
    const { reception, contract } = await setup();
    const { payment } = await pay(reception, contract.id, 5_000_000);

    await expect(prisma.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } })).rejects.toThrow(
      /payments_delete_complete/,
    );
    await expect(prisma.payment.update({ where: { id: payment.id }, data: { amount: 0 } })).rejects.toThrow(
      /payments_amount_positive/,
    );
  });
});

describe("reading", () => {
  it("lists payments by contract, customer, and day, deleted ones left out; totals what was collected", async () => {
    const { reception, customer, contract } = await setup();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const a = await pay(reception, contract.id, 1_000_000, randomUUID(), "01/10/2026");
    const b = await pay(reception, contract.id, 2_000_000, randomUUID(), "05/10/2026");
    const c = await pay(reception, contract.id, 3_000_000, randomUUID(), "03/10/2026");
    await deletePayment(accountant, c.payment.id, { reasonId: OTHER_REASON, reasonNote: "Sai" });

    expect((await listPayments(reception, { customerId: customer.id })).items.map((p) => p.id)).toEqual([
      b.payment.id,
      a.payment.id,
    ]);
    expect((await listPayments(reception, { from: "02/10/2026", to: "31/10/2026" })).total).toBe(1);
    expect(await collectedBetween(reception, { from: "01/10/2026", to: "31/10/2026" })).toBe(3_000_000);
  });

  it("the debt list shows owing contracts, largest first, without drafts (A-022)", async () => {
    const { reception, manager, customer, contract } = await setup();
    const small = await activeContract(manager, customer.id, { sessions: 4 });
    const paidUp = await activeContract(manager, customer.id, { sessions: 2 });
    await createContract(manager, customer.id, await contractInput(), randomUUID()); // draft
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
    expect(Object.fromEntries(items.map((c) => [c.id, c.paidAmount]))).toEqual({
      [contract.id]: 3_000_000,
      [other.id]: 0,
    });
  });
});
