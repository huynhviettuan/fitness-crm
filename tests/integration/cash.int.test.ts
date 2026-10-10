import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import type { Actor } from "@/lib/auth/session";
import { createCustomer } from "@/modules/customers/customer.service";
import {
  financeSummary,
  listCashTransactions,
  recordCashTransaction,
  voidCashTransaction,
} from "@/modules/finance/cash.service";
import { recordPayment } from "@/modules/finance/payment.service";
import { resetDatabase } from "../support/database";
import { createTestUser } from "../support/factories";
import { activeContract } from "../support/bookings";

afterEach(async () => {
  await resetDatabase();
});

const expense = { type: "EXPENSE", category: "Điện nước", amount: "1.500.000", occurredOn: "03/10/2026" };

const record = (actor: Actor, input: object = expense, key = randomUUID()) => recordCashTransaction(actor, input, key);

describe("recordCashTransaction", () => {
  it("records a CONFIRMED entry, stores blank optional text as null, and audits", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");

    const { transaction, replayed } = await record(accountant, { ...expense, reference: "", description: "  " });

    expect(replayed).toBe(false);
    expect(transaction).toMatchObject({ type: "EXPENSE", amount: 1_500_000, status: "CONFIRMED", reference: null, description: null });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: transaction.id } })).toMatchObject({ action: "cash_transaction.created" });
  });

  it("replays the same submission and refuses the same key with other content (T-015)", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const key = randomUUID();
    const first = await record(accountant, expense, key);

    expect(await record(accountant, expense, key)).toEqual({ transaction: first.transaction, replayed: true });
    await expect(record(accountant, { ...expense, amount: "2.000.000" }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const together = await Promise.all(Array.from({ length: 5 }, () => record(accountant, expense, key)));
    expect(new Set(together.map((r) => r.transaction.id))).toEqual(new Set([first.transaction.id]));
    expect(await prisma.cashTransaction.count()).toBe(1);
  });

  it("returns field errors for invalid input", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");

    await expect(record(accountant, { type: "GIFT", category: "", amount: "0", occurredOn: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { type: ["invalidChoice"], category: ["required"], amount: ["amountNotPositive"], occurredOn: ["required"] },
    });
  });

  it.each(["RECEPTIONIST", "TRAINER"] as const)("refuses a %s (docs/09)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(record(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCashTransactions(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("voidCashTransaction (A-009)", () => {
  it("voids with a reason, and a repeat returns the current state", async () => {
    const { actor: manager } = await createTestUser("MANAGER");
    const { transaction } = await record(manager);

    const voided = await voidCashTransaction(manager, transaction.id, { reason: "Nhập sai số tiền" });
    const again = await voidCashTransaction(manager, transaction.id, { reason: "Khác" });

    expect(voided).toMatchObject({ status: "VOIDED", voidReason: "Nhập sai số tiền", voidedBy: "MANAGER test user" });
    expect(again.voidReason).toBe("Nhập sai số tiền");
    expect(await prisma.auditEvent.count({ where: { entityId: transaction.id, action: "cash_transaction.voided" } })).toBe(1);
  });
});

describe("financeSummary (FR-CASH-002, OQ-007 interim)", () => {
  it("totals confirmed income, expenses, and contract payments as separate lines for the period", async () => {
    const { actor: manager } = await createTestUser("MANAGER");
    const customer = await createCustomer(manager, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const contract = await activeContract(manager, customer.id);
    await recordPayment(manager, contract.id, { amount: "5.000.000", method: "BANK_TRANSFER", paidOn: "02/10/2026" }, randomUUID());
    await record(manager, { type: "INCOME", category: "Bán nước", amount: "300.000", occurredOn: "04/10/2026" });
    await record(manager, expense);
    const voided = await record(manager, { ...expense, amount: "9.000.000" });
    await voidCashTransaction(manager, voided.transaction.id, { reason: "Trùng" });
    await record(manager, { ...expense, occurredOn: "30/09/2026" }); // previous month

    const summary = await financeSummary(manager, { from: "01/10/2026", to: "31/10/2026" });

    expect(summary).toEqual({ contractPayments: 5_000_000, otherIncome: 300_000, expense: 1_500_000 });
    expect((await listCashTransactions(manager, { from: "01/10/2026", to: "31/10/2026", type: "EXPENSE" })).total).toBe(2);
  });
});
