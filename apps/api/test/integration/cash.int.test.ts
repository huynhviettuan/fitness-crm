import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import {
  financeSummary,
  listCashTransactions,
  recordCashTransaction,
  deleteCashTransaction,
} from "../../src/modules/finance/cash.service.js";
import { recordPayment } from "../../src/modules/finance/payment.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestOption, createTestUser, optionId, withoutApprovals } from "../support/factories.js";
import { activeContract } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});
// These tests are about something else than approvals (approvals.int.test.ts).
beforeEach(async () => {
  await withoutApprovals();
});

const OTHER_REASON = await optionId("deleteReasons", "Khác");
const CASH = await optionId("paymentMethods", "Tiền mặt");

// Categories are options of the income and expense lists (D-016); tests add their own.
let expense: {
  type: string;
  categoryId: string;
  methodId: string;
  payee: string;
  amount: string;
  occurredOn: string;
};
let sales: string;
beforeEach(async () => {
  expense = {
    type: "EXPENSE",
    categoryId: await createTestOption("expenseTypes", "Điện nước"),
    methodId: CASH,
    payee: "Công ty điện lực",
    amount: "1.500.000",
    occurredOn: "03/10/2026",
  };
  sales = await createTestOption("incomeCategories", "Bán nước");
});

const record = (actor: Actor, input: object = expense, key = randomUUID()) => recordCashTransaction(actor, input, key);

describe("recordCashTransaction", () => {
  it("records an entry, stores blank optional text as null, and audits", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");

    const { transaction, replayed } = await record(accountant, { ...expense, reference: "", description: "  " });

    expect(replayed).toBe(false);
    expect(transaction).toMatchObject({ type: "EXPENSE", amount: 1_500_000, reference: null, description: null });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: transaction.id } })).toMatchObject({
      action: "cash_transaction.created",
    });
  });

  it("replays the same submission and refuses the same key with other content (T-015)", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const key = randomUUID();
    const first = await record(accountant, expense, key);

    expect(await record(accountant, expense, key)).toEqual({ transaction: first.transaction, replayed: true });
    await expect(record(accountant, { ...expense, amount: "2.000.000" }, key)).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    const together = await Promise.all(Array.from({ length: 5 }, () => record(accountant, expense, key)));
    expect(new Set(together.map((r) => r.transaction.id))).toEqual(new Set([first.transaction.id]));
    expect(await prisma.cashTransaction.count()).toBe(1);
  });

  it("returns field errors for invalid input", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");

    await expect(
      record(accountant, { type: "GIFT", categoryId: "", amount: "0", occurredOn: "" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: {
        type: ["invalidChoice"],
        categoryId: ["required"],
        amount: ["amountNotPositive"],
        occurredOn: ["required"],
      },
    });
  });

  it("takes the category from the list of its type; Khác needs a note (D-016, AC-04)", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const otherExpense = await optionId("expenseTypes", "Khác");

    await expect(record(accountant, { ...expense, categoryId: sales })).rejects.toMatchObject({
      fieldErrors: { categoryId: ["invalidChoice"] },
    });
    await expect(record(accountant, { ...expense, categoryId: otherExpense })).rejects.toMatchObject({
      fieldErrors: { categoryNote: ["otherNeedsNote"] },
    });
    const { transaction } = await record(accountant, {
      ...expense,
      categoryId: otherExpense,
      categoryNote: "Sơn lại phòng",
    });
    expect(transaction.category).toMatchObject({ labelVi: "Khác", isOther: true, note: "Sơn lại phòng" });
  });

  it.each(["RECEPTIONIST", "PT"] as const)("refuses a %s (docs/09)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(record(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCashTransactions(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("deleteCashTransaction (D-035)", () => {
  it("moves the entry to the trash with its reason; it leaves the list, and deleting again is NOT_FOUND", async () => {
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const { transaction } = await record(accountant);

    await deleteCashTransaction(accountant, transaction.id, { reasonId: OTHER_REASON, reasonNote: "Nhập sai số tiền" });

    expect((await listCashTransactions(accountant, {})).total).toBe(0);
    expect(await prisma.trashEntry.findFirst({ where: { entityId: transaction.id } })).toMatchObject({
      entityType: "cash_transaction",
      title: expect.stringMatching(/^PC\d{6} · Điện nước$/),
      reasonNote: "Nhập sai số tiền",
      snapshot: { id: transaction.id, type: "EXPENSE", amount: 1_500_000 },
    });
    await expect(
      deleteCashTransaction(accountant, transaction.id, { reasonId: OTHER_REASON, reasonNote: "Lần hai" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await prisma.auditEvent.count({ where: { entityId: transaction.id, action: "cash_transaction.deleted" } }),
    ).toBe(1);
  });

  // 09_RBAC.md: a Fitness Manager records income and expenses but does not delete vouchers.
  it("refuses a FITNESS_MANAGER", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { transaction } = await record(manager);

    await expect(
      deleteCashTransaction(manager, transaction.id, { reasonId: OTHER_REASON, reasonNote: "x" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("financeSummary (FR-CASH-002, OQ-007 interim)", () => {
  it("totals income, expenses, and contract payments as separate lines for the period, deleted ones left out", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");
    const customer = await createCustomer(manager, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const contract = await activeContract(manager, customer.id);
    await recordPayment(
      manager,
      contract.id,
      { amount: "5.000.000", methodId: await optionId("paymentMethods", "Chuyển khoản"), paidOn: "02/10/2026" },
      randomUUID(),
    );
    await record(manager, {
      type: "INCOME",
      categoryId: sales,
      methodId: CASH,
      amount: "300.000",
      occurredOn: "04/10/2026",
    });
    await record(manager, expense);
    const voided = await record(manager, { ...expense, amount: "9.000.000" });
    await deleteCashTransaction(admin, voided.transaction.id, { reasonId: OTHER_REASON, reasonNote: "Trùng" });
    await record(manager, { ...expense, occurredOn: "30/09/2026" }); // previous month

    const summary = await financeSummary(manager, { from: "01/10/2026", to: "31/10/2026" });

    expect(summary).toEqual({ contractPayments: 5_000_000, otherIncome: 300_000, expense: 1_500_000 });
    expect((await listCashTransactions(manager, { from: "01/10/2026", to: "31/10/2026", type: "EXPENSE" })).total).toBe(
      1,
    );
  });
});
