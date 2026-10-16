import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { chosenSelect } from "../../platform/options/option.service.js";
import { branchSql } from "./report-scope.js";

// The cash book reads (M4.7, A-138): every movement of cash is a valid receipt (approved, not deleted) or a valid cash
// transaction; pending, rejected and deleted ones never count (D-018, D-035). Opening amounts of imported contracts are
// not payments, so they stay out (D-011).

/** Receipts and cash transactions as one list of movements: branch, method, day, and what came in and went out. */
const movements = Prisma.sql`
  SELECT p.branch_id, p.method_option_id AS method_id, p.paid_on AS day, p.amount AS inflow, 0::numeric AS outflow
  FROM payments p
  WHERE p.deleted_at IS NULL AND p.approval_status = 'APPROVED'
  UNION ALL
  SELECT t.branch_id, t.method_option_id, t.occurred_on,
         CASE WHEN t.type = 'INCOME' THEN t.amount ELSE 0::numeric END,
         CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE 0::numeric END
  FROM cash_transactions t
  WHERE t.deleted_at IS NULL AND t.approval_status = 'APPROVED'`;

export type OpeningRow = { branchId: string; methodId: string; opening: number };
export type DayRow = { branchId: string; methodId: string; day: string; inflow: number; outflow: number };

/**
 * Per branch and method: the cash at the start of `from`, which is the opening amount plus what moved between the day
 * the books began and the day before `from`. Rows exist for every method that has an opening amount or a movement.
 */
export async function openingBefore(db: Db, branches: string[] | "ALL", from: Date): Promise<OpeningRow[]> {
  const rows = await db.$queryRaw<{ branch_id: string; method_id: string; opening: Prisma.Decimal }[]>`
    SELECT k.branch_id, k.method_id,
           COALESCE(o.amount, 0) + COALESCE(SUM(m.inflow - m.outflow), 0) AS opening
    FROM (
      SELECT branch_id, method_option_id AS method_id FROM cash_opening_balances
      UNION
      SELECT branch_id, method_id FROM (${movements}) all_moves
    ) k
    LEFT JOIN cash_opening_balances o ON o.branch_id = k.branch_id AND o.method_option_id = k.method_id
    LEFT JOIN (${movements}) m ON m.branch_id = k.branch_id AND m.method_id = k.method_id
         AND m.day < ${from}::date AND m.day >= COALESCE(o.effective_on, DATE '0001-01-01')
    WHERE ${branchSql(Prisma.sql`k.branch_id`, branches)}
    GROUP BY k.branch_id, k.method_id, o.amount`;
  return rows.map((row) => ({ branchId: row.branch_id, methodId: row.method_id, opening: Number(row.opening) }));
}

/** What moved on each day of the period, per branch and method, from the day the books began (A-138). */
export async function movedBetween(db: Db, branches: string[] | "ALL", from: Date, to: Date): Promise<DayRow[]> {
  const rows = await db.$queryRaw<
    { branch_id: string; method_id: string; day: Date; inflow: Prisma.Decimal; outflow: Prisma.Decimal }[]
  >`
    SELECT m.branch_id, m.method_id, m.day, SUM(m.inflow) AS inflow, SUM(m.outflow) AS outflow
    FROM (${movements}) m
    LEFT JOIN cash_opening_balances o ON o.branch_id = m.branch_id AND o.method_option_id = m.method_id
    WHERE m.day >= ${from}::date AND m.day <= ${to}::date
      AND m.day >= COALESCE(o.effective_on, DATE '0001-01-01')
      AND ${branchSql(Prisma.sql`m.branch_id`, branches)}
    GROUP BY m.branch_id, m.method_id, m.day`;
  return rows.map((row) => ({
    branchId: row.branch_id,
    methodId: row.method_id,
    day: row.day.toISOString().slice(0, 10),
    inflow: Number(row.inflow),
    outflow: Number(row.outflow),
  }));
}

export function branchNames(db: Db, ids: string[]) {
  return db.branch.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
}

export function optionsByIds(db: Db, ids: string[]) {
  return db.option.findMany({ where: { id: { in: ids } }, select: chosenSelect });
}

const openingInclude = {
  branch: { select: { id: true, name: true } },
  method: { select: chosenSelect },
} as const satisfies Prisma.CashOpeningBalanceInclude;

export function listOpenings(db: Db, where: Prisma.CashOpeningBalanceWhereInput) {
  return db.cashOpeningBalance.findMany({
    where,
    include: openingInclude,
    orderBy: [{ branch: { name: "asc" } }, { method: { sortOrder: "asc" } }],
  });
}

export function findOpening(db: Db, branchId: string, methodId: string) {
  return db.cashOpeningBalance.findUnique({
    where: { branchId_methodId: { branchId, methodId } },
    include: openingInclude,
  });
}

export function saveOpening(
  db: Db,
  data: { branchId: string; methodId: string; effectiveOn: Date; amount: number; updatedById: string },
) {
  const { branchId, methodId, ...fields } = data;
  return db.cashOpeningBalance.upsert({
    where: { branchId_methodId: { branchId, methodId } },
    create: { branchId, methodId, ...fields },
    update: fields,
    include: openingInclude,
  });
}

/** Receipts of contracts in the period: how many and how much (the "contract payments" line of the report). */
export async function paymentTotals(db: Db, branches: string[] | "ALL", from: Date, to: Date) {
  const [row] = await db.$queryRaw<{ count: bigint; amount: Prisma.Decimal | null }[]>`
    SELECT COUNT(*) AS count, SUM(p.amount) AS amount
    FROM payments p
    WHERE p.deleted_at IS NULL AND p.approval_status = 'APPROVED'
      AND p.paid_on >= ${from}::date AND p.paid_on <= ${to}::date
      AND ${branchSql(Prisma.sql`p.branch_id`, branches)}`;
  return { count: Number(row.count), amount: Number(row.amount ?? 0) };
}

/** Other income and expenses in the period, per type and category. */
export async function cashByCategory(db: Db, branches: string[] | "ALL", from: Date, to: Date) {
  const rows = await db.$queryRaw<
    { type: "INCOME" | "EXPENSE"; category_id: string; count: bigint; amount: Prisma.Decimal }[]
  >`
    SELECT t.type, t.category_option_id AS category_id, COUNT(*) AS count, SUM(t.amount) AS amount
    FROM cash_transactions t
    WHERE t.deleted_at IS NULL AND t.approval_status = 'APPROVED'
      AND t.occurred_on >= ${from}::date AND t.occurred_on <= ${to}::date
      AND ${branchSql(Prisma.sql`t.branch_id`, branches)}
    GROUP BY t.type, t.category_option_id`;
  return rows.map((row) => ({
    type: row.type,
    categoryId: row.category_id,
    count: Number(row.count),
    amount: Number(row.amount),
  }));
}
