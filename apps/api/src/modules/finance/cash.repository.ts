import type { Db } from "../../platform/db/prisma.js";
import type { CashTransactionType, Prisma } from "../../generated/prisma/client.js";
import type { CashTransactionData } from "@flow/shared/finance";
import { chosenSelect } from "../../platform/options/option.service.js";

const cashInclude = {
  branch: { select: { id: true, name: true } },
  category: { select: chosenSelect },
  createdBy: { select: { name: true } },
} as const satisfies Prisma.CashTransactionInclude;

export type CashTransactionRecord = Prisma.CashTransactionGetPayload<{ include: typeof cashInclude }>;

export function createCashTransaction(
  db: Db,
  data: Omit<CashTransactionData, "branchId"> & {
    branchId: string;
    idempotencyKey: string;
    createdById: string;
    approvalStatus: "PENDING" | "APPROVED";
  },
): Promise<CashTransactionRecord> {
  return db.cashTransaction.create({ data, include: cashInclude });
}

export function findCashTransaction(
  db: Db,
  id: string,
  visibility: Prisma.CashTransactionWhereInput = {},
): Promise<CashTransactionRecord | null> {
  return db.cashTransaction.findFirst({ where: { AND: [{ id, deletedAt: null }, visibility] }, include: cashInclude });
}

export function findCashTransactionByIdempotencyKey(db: Db, idempotencyKey: string): Promise<CashTransactionRecord | null> {
  return db.cashTransaction.findUnique({ where: { idempotencyKey }, include: cashInclude });
}

/** Marks the transaction deleted only if it is not already (D-035). Returns rows changed. */
export async function markCashTransactionDeleted(
  db: Db,
  id: string,
  data: { deletedAt: Date; deletedById: string; deleteReasonId: string; deleteReasonNote: string | null },
): Promise<number> {
  const { count } = await db.cashTransaction.updateMany({ where: { id, deletedAt: null }, data });
  return count;
}

export async function listCashTransactions(db: Db, where: Prisma.CashTransactionWhereInput, options: { skip: number; take: number }) {
  // Deleted records are in the trash, not in lists (D-035).
  const valid = { AND: [where, { deletedAt: null }] };
  const [items, total] = await Promise.all([
    db.cashTransaction.findMany({
      where: valid,
      include: cashInclude,
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      skip: options.skip,
      take: options.take,
    }),
    db.cashTransaction.count({ where: valid }),
  ]);
  return { items, total };
}

/** SUM of the valid transactions (approved, not deleted) of one type between two days, inclusive, within `visibility`. */
export async function sumValidCash(
  db: Db,
  type: CashTransactionType,
  from: Date,
  to: Date,
  visibility: Prisma.CashTransactionWhereInput,
): Promise<number> {
  const { _sum } = await db.cashTransaction.aggregate({
    where: { AND: [visibility, { type, deletedAt: null, approvalStatus: "APPROVED", occurredOn: { gte: from, lte: to } }] },
    _sum: { amount: true },
  });
  return Number(_sum.amount ?? 0);
}

/** Moves an entry's approval status only from `from`, so a decision applies once (D-018). */
export async function setCashApprovalStatus(db: Db, id: string, from: "PENDING", to: "APPROVED" | "REJECTED"): Promise<number> {
  const { count } = await db.cashTransaction.updateMany({ where: { id, approvalStatus: from, deletedAt: null }, data: { approvalStatus: to } });
  return count;
}
