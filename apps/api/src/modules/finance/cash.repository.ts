import type { Db } from "../../platform/db/prisma.js";
import type { CashTransactionType, Prisma } from "../../generated/prisma/client.js";
import type { CashTransactionData } from "@flow/shared/finance";
import { chosenSelect } from "../../platform/options/option.service.js";

const cashInclude = {
  branch: { select: { id: true, name: true } },
  category: { select: chosenSelect },
  voidReason: { select: chosenSelect },
  createdBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
} as const satisfies Prisma.CashTransactionInclude;

export type CashTransactionRecord = Prisma.CashTransactionGetPayload<{ include: typeof cashInclude }>;

export function createCashTransaction(
  db: Db,
  data: Omit<CashTransactionData, "branchId"> & { branchId: string; idempotencyKey: string; createdById: string },
): Promise<CashTransactionRecord> {
  return db.cashTransaction.create({ data, include: cashInclude });
}

export function findCashTransaction(
  db: Db,
  id: string,
  visibility: Prisma.CashTransactionWhereInput = {},
): Promise<CashTransactionRecord | null> {
  return db.cashTransaction.findFirst({ where: { AND: [{ id }, visibility] }, include: cashInclude });
}

export function findCashTransactionByIdempotencyKey(db: Db, idempotencyKey: string): Promise<CashTransactionRecord | null> {
  return db.cashTransaction.findUnique({ where: { idempotencyKey }, include: cashInclude });
}

/** Voids the transaction only if it is still CONFIRMED. Returns rows changed. */
export async function voidCashTransaction(
  db: Db,
  id: string,
  data: { voidedAt: Date; voidedById: string; voidReasonId: string; voidReasonNote: string | null },
): Promise<number> {
  const { count } = await db.cashTransaction.updateMany({ where: { id, status: "CONFIRMED" }, data: { ...data, status: "VOIDED" } });
  return count;
}

export async function listCashTransactions(db: Db, where: Prisma.CashTransactionWhereInput, options: { skip: number; take: number }) {
  const [items, total] = await Promise.all([
    db.cashTransaction.findMany({
      where,
      include: cashInclude,
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      skip: options.skip,
      take: options.take,
    }),
    db.cashTransaction.count({ where }),
  ]);
  return { items, total };
}

/** SUM of CONFIRMED transactions of one type between two days, inclusive, within `visibility`. */
export async function sumConfirmedCash(
  db: Db,
  type: CashTransactionType,
  from: Date,
  to: Date,
  visibility: Prisma.CashTransactionWhereInput,
): Promise<number> {
  const { _sum } = await db.cashTransaction.aggregate({
    where: { AND: [visibility, { type, status: "CONFIRMED", occurredOn: { gte: from, lte: to } }] },
    _sum: { amount: true },
  });
  return Number(_sum.amount ?? 0);
}
