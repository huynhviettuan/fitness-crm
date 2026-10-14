import type { Db } from "../../platform/db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { formatCode } from "@flow/shared/parameters";
import { chosenSelect } from "../../platform/options/option.service.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";

const paymentInclude = {
  contract: {
    select: {
      id: true,
      contractCode: true,
      packageName: true,
      customer: { select: { id: true, customerCode: true, fullName: true } },
    },
  },
  method: { select: chosenSelect },
  saleEmployee: { select: { id: true, employeeCode: true, fullName: true } },
  createdBy: { select: { name: true } },
} as const satisfies Prisma.PaymentInclude;

/**
 * The next receipt number (D-034): from the sequence, so concurrent callers never share one and a deleted receipt's
 * number is never given again. Receipts without a contract draw from the same series.
 */
export async function nextReceiptNumber(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('receipt_seq') AS value`;
  return formatCode(await readParameter(db, "receiptCodePrefix"), row.value, 6);
}

export type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function createPayment(
  db: Db,
  data: {
    contractId: string;
    branchId: string;
    amount: number;
    methodId: string;
    methodNote: string | null;
    receiptNumber: string;
    saleEmployeeId: string | null;
    note: string | null;
    approvalStatus: "PENDING" | "APPROVED";
    paidOn: Date;
    idempotencyKey: string;
    createdById: string;
  },
): Promise<PaymentRecord> {
  return db.payment.create({ data, include: paymentInclude });
}

/** A payment that is not deleted (D-035). */
export function findPayment(
  db: Db,
  id: string,
  visibility: Prisma.PaymentWhereInput = {},
): Promise<PaymentRecord | null> {
  return db.payment.findFirst({ where: { AND: [{ id, deletedAt: null }, visibility] }, include: paymentInclude });
}

export function findPaymentByIdempotencyKey(db: Db, idempotencyKey: string): Promise<PaymentRecord | null> {
  return db.payment.findUnique({ where: { idempotencyKey }, include: paymentInclude });
}

/** Marks the payment deleted only if it is not already (D-035). Returns rows changed. */
export async function markPaymentDeleted(
  db: Db,
  id: string,
  data: { deletedAt: Date; deletedById: string; deleteReasonId: string; deleteReasonNote: string | null },
): Promise<number> {
  const { count } = await db.payment.updateMany({ where: { id, deletedAt: null }, data });
  return count;
}

export async function listPayments(db: Db, where: Prisma.PaymentWhereInput, options: { skip: number; take: number }) {
  // Deleted records are in the trash, not in lists (D-035).
  const valid = { AND: [where, { deletedAt: null }] };
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where: valid,
      include: paymentInclude,
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      skip: options.skip,
      take: options.take,
    }),
    db.payment.count({ where: valid }),
  ]);
  return { items, total };
}

/** SUM of the valid payments matching `where`: approved and not deleted (BR-013, D-018, D-035). */
export async function sumValidPayments(db: Db, where: Prisma.PaymentWhereInput): Promise<number> {
  const { _sum } = await db.payment.aggregate({
    where: { AND: [where, { deletedAt: null, approvalStatus: "APPROVED" }] },
    _sum: { amount: true },
  });
  return Number(_sum.amount ?? 0);
}

/**
 * SUM of the payments that are valid or waiting for approval (A-038): what a contract's
 * value must still cover, so approving a pending payment can never overpay it.
 */
export async function sumCommittedPayments(db: Db, where: Prisma.PaymentWhereInput): Promise<number> {
  const { _sum } = await db.payment.aggregate({
    where: { AND: [where, { deletedAt: null, approvalStatus: { in: ["PENDING", "APPROVED"] } }] },
    _sum: { amount: true },
  });
  return Number(_sum.amount ?? 0);
}

/** Moves a payment's approval status only from `from`, so a decision applies once (D-018). */
export async function setPaymentApprovalStatus(
  db: Db,
  id: string,
  from: "PENDING",
  to: "APPROVED" | "REJECTED",
): Promise<number> {
  const { count } = await db.payment.updateMany({
    where: { id, approvalStatus: from, deletedAt: null },
    data: { approvalStatus: to },
  });
  return count;
}

/** Paid amount per contract from payments that are not deleted, for a page of contracts. */
export async function validPaidByContract(db: Db, contractIds: string[]): Promise<Map<string, number>> {
  if (contractIds.length === 0) return new Map();
  const rows = await db.payment.groupBy({
    by: ["contractId"],
    where: { contractId: { in: contractIds }, deletedAt: null, approvalStatus: "APPROVED" },
    _sum: { amount: true },
  });
  return new Map(rows.map((row) => [row.contractId, Number(row._sum.amount ?? 0)]));
}

/** Which contracts a debt list may show: branches and "own" scope (D-014, D-017, A-029). */
export type DebtScope = { branchIds: string[] | "ALL"; ownBy: { userId: string; employeeId: string | null } | null };

function debtScopeSql(scope: DebtScope): Prisma.Sql {
  const branch =
    scope.branchIds === "ALL" ? Prisma.sql`TRUE` : Prisma.sql`c.branch_id = ANY(${scope.branchIds}::uuid[])`;
  if (!scope.ownBy) return branch;
  const { userId, employeeId } = scope.ownBy;
  const viaTrainer = employeeId
    ? Prisma.sql`OR EXISTS (SELECT 1 FROM bookings b WHERE b.customer_id = c.customer_id AND b.trainer_id = ${employeeId}::uuid)`
    : Prisma.empty;
  return Prisma.sql`${branch} AND (
    c.created_by = ${userId}::uuid
    OR EXISTS (SELECT 1 FROM customers cu WHERE cu.id = c.customer_id AND cu.created_by = ${userId}::uuid)
    ${viaTrainer}
  )`;
}

/**
 * Contracts that still owe money, largest debt first (BR-013). Drafts, rejected and deleted contracts have not taken
 * effect and are left out (A-022, M4.7); cancelled contracts keep their debt (OQ-013 interim).
 */
export async function contractsWithDebt(db: Db, scope: DebtScope, options: { skip: number; take: number }) {
  const where = debtScopeSql(scope);
  const [rows, [{ total }]] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM contracts c
      LEFT JOIN payments p ON p.contract_id = c.id AND p.deleted_at IS NULL AND p.approval_status = 'APPROVED'
      WHERE c.status NOT IN ('DRAFT', 'REJECTED') AND c.deleted_at IS NULL AND ${where}
      GROUP BY c.id
      HAVING c.contract_value + c.voucher_value - c.opening_paid_amount - COALESCE(SUM(p.amount), 0) > 0
      ORDER BY c.contract_value + c.voucher_value - c.opening_paid_amount - COALESCE(SUM(p.amount), 0) DESC, c.contract_code
      LIMIT ${options.take} OFFSET ${options.skip}`,
    db.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM (
        SELECT c.id
        FROM contracts c
        LEFT JOIN payments p ON p.contract_id = c.id AND p.deleted_at IS NULL AND p.approval_status = 'APPROVED'
        WHERE c.status NOT IN ('DRAFT', 'REJECTED') AND c.deleted_at IS NULL AND ${where}
        GROUP BY c.id
        HAVING c.contract_value + c.voucher_value - c.opening_paid_amount - COALESCE(SUM(p.amount), 0) > 0
      ) owing`,
  ]);
  return { ids: rows.map((row) => row.id), total: Number(total) };
}
