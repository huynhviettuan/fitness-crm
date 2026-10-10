import type { Db } from "../../platform/db/prisma.js";
import type { PaymentMethod, Prisma } from "../../generated/prisma/client.js";

const paymentInclude = {
  contract: {
    select: { id: true, contractCode: true, packageName: true, customer: { select: { id: true, customerCode: true, fullName: true } } },
  },
  createdBy: { select: { name: true } },
  voidedBy: { select: { name: true } },
} as const satisfies Prisma.PaymentInclude;

export type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function createPayment(
  db: Db,
  data: { contractId: string; amount: number; method: PaymentMethod; paidOn: Date; idempotencyKey: string; createdById: string },
): Promise<PaymentRecord> {
  return db.payment.create({ data, include: paymentInclude });
}

export function findPayment(db: Db, id: string): Promise<PaymentRecord | null> {
  return db.payment.findUnique({ where: { id }, include: paymentInclude });
}

export function findPaymentByIdempotencyKey(db: Db, idempotencyKey: string): Promise<PaymentRecord | null> {
  return db.payment.findUnique({ where: { idempotencyKey }, include: paymentInclude });
}

/** Voids the payment only if it is still CONFIRMED. Returns rows changed. */
export async function voidPayment(db: Db, id: string, data: { voidedAt: Date; voidedById: string; voidReason: string }): Promise<number> {
  const { count } = await db.payment.updateMany({ where: { id, status: "CONFIRMED" }, data: { ...data, status: "VOIDED" } });
  return count;
}

export async function listPayments(db: Db, where: Prisma.PaymentWhereInput, options: { skip: number; take: number }) {
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      skip: options.skip,
      take: options.take,
    }),
    db.payment.count({ where }),
  ]);
  return { items, total };
}

/** SUM of CONFIRMED payments matching `where` (BR-013, BR-014). */
export async function sumConfirmedPayments(db: Db, where: Prisma.PaymentWhereInput): Promise<number> {
  const { _sum } = await db.payment.aggregate({ where: { AND: [where, { status: "CONFIRMED" }] }, _sum: { amount: true } });
  return Number(_sum.amount ?? 0);
}

/** Confirmed paid amount per contract, for a page of contracts. */
export async function confirmedPaidByContract(db: Db, contractIds: string[]): Promise<Map<string, number>> {
  if (contractIds.length === 0) return new Map();
  const rows = await db.payment.groupBy({
    by: ["contractId"],
    where: { contractId: { in: contractIds }, status: "CONFIRMED" },
    _sum: { amount: true },
  });
  return new Map(rows.map((row) => [row.contractId, Number(row._sum.amount ?? 0)]));
}

/**
 * Contracts that still owe money, largest debt first (BR-013). Drafts have not taken
 * effect and are left out (A-022); cancelled contracts keep their debt (OQ-013 interim).
 */
export async function contractsWithDebt(db: Db, options: { skip: number; take: number }) {
  const [rows, [{ total }]] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM contracts c
      LEFT JOIN payments p ON p.contract_id = c.id AND p.status = 'CONFIRMED'
      WHERE c.status <> 'DRAFT'
      GROUP BY c.id
      HAVING c.contract_value - c.opening_paid_amount - COALESCE(SUM(p.amount), 0) > 0
      ORDER BY c.contract_value - c.opening_paid_amount - COALESCE(SUM(p.amount), 0) DESC, c.contract_code
      LIMIT ${options.take} OFFSET ${options.skip}`,
    db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM (
        SELECT c.id
        FROM contracts c
        LEFT JOIN payments p ON p.contract_id = c.id AND p.status = 'CONFIRMED'
        WHERE c.status <> 'DRAFT'
        GROUP BY c.id
        HAVING c.contract_value - c.opening_paid_amount - COALESCE(SUM(p.amount), 0) > 0
      ) owing`,
  ]);
  return { ids: rows.map((row) => row.id), total: Number(total) };
}
