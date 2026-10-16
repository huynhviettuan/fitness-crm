import {
  cashBookDays,
  cashOpeningInputSchema,
  closingBalance,
  periodReportQuerySchema,
  type CashBook,
  type CashOpening,
  type IncomeExpense,
} from "@gymcrm/shared/finance";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { isMasked, resolveBranch } from "../../platform/permissions/scope.js";
import { chosen } from "../../platform/options/option.service.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as repo from "./cash-book.repository.js";
import { assertWholeScope, branchesOf, periodOf } from "./report-scope.js";
import type { Permission } from "@gymcrm/shared/permissions";

// The cash book and the income and expense report (brief §8.1, §9, FR-CASH-005, AC-19; A-138, A-139): the same valid
// receipts and vouchers the Finance screens list, never a figure kept apart.

/** Who may see the money reports: the permission, a whole-record scope for vouchers, and receipt totals not hidden (D-017). */
function assertMoneyReport(actor: Actor, permission: Permission): void {
  assertCan(actor, permission);
  assertWholeScope(actor, "vouchers", permission);
  if (isMasked(actor, "receipts.totals")) throw forbidden(actor, permission, "maskedMoney");
}

/**
 * The cash book of a period (A-138): per branch and method the opening balance, what came in, what went out, and the
 * closing balance, and the same day by day. Closing = opening + in - out (AC-19). Receipts of contracts and income
 * both come in; expense vouchers go out.
 */
export async function cashBook(actor: Actor, rawQuery: unknown): Promise<CashBook> {
  assertMoneyReport(actor, "report.cashBook");
  const query = parseInput(periodReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);

  const [openings, moved] = await Promise.all([
    repo.openingBefore(prisma, branches, from),
    repo.movedBetween(prisma, branches, from, to),
  ]);
  const key = (branchId: string, methodId: string) => `${branchId}:${methodId}`;
  const combined = new Map<
    string,
    { branchId: string; methodId: string; opening: number; inflow: number; outflow: number }
  >();
  for (const row of openings) {
    combined.set(key(row.branchId, row.methodId), { ...row, inflow: 0, outflow: 0 });
  }
  const perDay = new Map<string, { inflow: number; outflow: number }>();
  for (const row of moved) {
    const entry = combined.get(key(row.branchId, row.methodId)) ?? { ...row, opening: 0, inflow: 0, outflow: 0 };
    entry.inflow += row.inflow;
    entry.outflow += row.outflow;
    combined.set(key(row.branchId, row.methodId), entry);
    const day = perDay.get(row.day) ?? { inflow: 0, outflow: 0 };
    day.inflow += row.inflow;
    day.outflow += row.outflow;
    perDay.set(row.day, day);
  }

  const entries = [...combined.values()];
  const [branchList, methodList] = await Promise.all([
    repo.branchNames(prisma, [...new Set(entries.map((entry) => entry.branchId))]),
    repo.optionsByIds(prisma, [...new Set(entries.map((entry) => entry.methodId))]),
  ]);
  const branchById = new Map(branchList.map((branch) => [branch.id, branch]));
  const methodById = new Map(methodList.map((method) => [method.id, method]));
  const rows = entries
    .map((entry) => ({
      branch: branchById.get(entry.branchId)!,
      method: chosen(methodById.get(entry.methodId)!, null),
      opening: entry.opening,
      inflow: entry.inflow,
      outflow: entry.outflow,
      closing: closingBalance(entry.opening, entry.inflow, entry.outflow),
    }))
    .sort((a, b) => a.branch.name.localeCompare(b.branch.name) || a.method.labelVi.localeCompare(b.method.labelVi));

  const total = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const totals = {
    opening: total((row) => row.opening),
    inflow: total((row) => row.inflow),
    outflow: total((row) => row.outflow),
    closing: total((row) => row.closing),
  };
  return { from, to, rows, days: cashBookDays(totals.opening, from, to, perDay), totals };
}

/**
 * Income and expense of a period by category (A-139): receipts of contracts, other income by category, and expenses by
 * category. Net = income - expense; contract receipts are cash-book income (D-034), so the cash book counts all of them
 * the same way (AC-19).
 */
export async function incomeExpense(actor: Actor, rawQuery: unknown): Promise<IncomeExpense> {
  assertMoneyReport(actor, "report.incomeExpense");
  const query = parseInput(periodReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);

  const [payments, byCategory] = await Promise.all([
    repo.paymentTotals(prisma, branches, from, to),
    repo.cashByCategory(prisma, branches, from, to),
  ]);
  const categories = await repo.optionsByIds(prisma, [...new Set(byCategory.map((row) => row.categoryId))]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const lines: IncomeExpense["lines"] = [
    { kind: "CONTRACT_PAYMENT", category: null, count: payments.count, amount: payments.amount },
    ...byCategory
      .map((row) => ({
        kind: row.type,
        category: chosen(categoryById.get(row.categoryId)!, null),
        count: row.count,
        amount: row.amount,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.amount - a.amount),
  ];
  const sum = (kinds: string[]) =>
    lines.filter((line) => kinds.includes(line.kind)).reduce((total, line) => total + line.amount, 0);
  const income = sum(["CONTRACT_PAYMENT", "INCOME"]);
  const expense = sum(["EXPENSE"]);
  return { from, to, lines, income, expense, net: income - expense };
}

function toOpening(row: NonNullable<Awaited<ReturnType<typeof repo.findOpening>>>): CashOpening {
  return {
    branch: row.branch,
    method: chosen(row.method, null),
    effectiveOn: row.effectiveOn,
    amount: Number(row.amount),
  };
}

/** The opening balances set so far, in the branches the actor works in. */
export async function listCashOpenings(actor: Actor): Promise<{ items: CashOpening[] }> {
  assertMoneyReport(actor, "report.cashBook");
  const rows = await repo.listOpenings(
    prisma,
    actor.branches === "ALL" ? {} : { branchId: { in: [...actor.branches] } },
  );
  return { items: rows.map(toOpening) };
}

/**
 * Sets the cash a branch held in a payment method when its books begin (A-138). It moves every closing balance after
 * it, so it is Admin's and audited with the old and new values.
 */
export async function setCashOpening(actor: Actor, rawInput: unknown): Promise<CashOpening> {
  assertCan(actor, "cash.opening");
  const data = parseInput(cashOpeningInputSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, data.branchId);
    const method = await tx.option.findFirst({
      where: { id: data.methodId, listKey: "paymentMethods", isOther: false },
      select: { id: true },
    });
    if (!method) throw new AppError("VALIDATION_FAILED", { fieldErrors: { methodId: ["invalidChoice"] } });

    const before = await repo.findOpening(tx, branchId, method.id);
    const saved = await repo.saveOpening(tx, {
      branchId,
      methodId: method.id,
      effectiveOn: data.effectiveOn,
      amount: data.amount,
      updatedById: actor.id,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "cash_opening_balance",
      entityId: saved.id,
      action: before ? "cash_opening.updated" : "cash_opening.set",
      before: before
        ? { effectiveOn: before.effectiveOn.toISOString().slice(0, 10), amount: Number(before.amount) }
        : undefined,
      after: { effectiveOn: data.effectiveOn.toISOString().slice(0, 10), amount: data.amount, methodId: method.id },
    });
    return toOpening(saved);
  });
}
