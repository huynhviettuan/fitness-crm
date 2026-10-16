import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { branchSql } from "../reports/report-scope.js";

// PT payouts (M5.7, D-027, D-032): the queries that find what is left to pay a PT, and the payouts themselves. A line is
// live until its payout is void (the trigger of the migration releases it), so "paid" always means "paid and standing".

type Period = { from: Date; to: Date };

export type PayableSession = {
  bookingId: string;
  contractId: string;
  contractValue: number;
  vatAmount: number;
  totalSessions: number;
  bonusSessions: number;
  commissionRate: number;
};

/** The employee row, locked: payouts of one PT take turns, so two at once never pay the same session (INT-011). */
export async function lockTrainer(db: Db, id: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM employees WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) return null;
  return db.employee.findUnique({
    where: { id },
    select: { id: true, branchId: true, fullName: true, employeeCode: true },
  });
}

/**
 * The sessions that credit the PT in the period and that no standing payout has paid, oldest first, with what the
 * allocation needs of their contract. A contract brought over without a service pays the rate every service starts with.
 */
export async function payableSessions(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  timeZone: string,
  trainerId: string,
): Promise<PayableSession[]> {
  const day = Prisma.sql`(b.scheduled_start AT TIME ZONE ${timeZone}::text)::date`;
  const rows = await db.$queryRaw<
    {
      booking_id: string;
      contract_id: string;
      contract_value: Prisma.Decimal;
      vat_amount: Prisma.Decimal;
      total_sessions: number;
      bonus_sessions: number;
      commission_rate: Prisma.Decimal | null;
    }[]
  >`
    SELECT b.id AS booking_id, b.contract_id, c.contract_value + c.voucher_value AS contract_value, c.vat_amount,
           c.total_sessions + c.voucher_sessions AS total_sessions, c.bonus_sessions,
           s.commission_rate
    FROM bookings b
    JOIN contracts c ON c.id = b.contract_id
    LEFT JOIN services s ON s.id = c.service_id
    WHERE b.credits_pt AND b.trainer_id = ${trainerId}::uuid
      AND ${day} >= ${period.from}::date AND ${day} <= ${period.to}::date
      AND ${branchSql(Prisma.sql`b.branch_id`, branches)}
      AND NOT EXISTS (
        SELECT 1 FROM pt_payout_lines l
        WHERE l.booking_id = b.id AND l.kind = 'SESSION' AND l.released_at IS NULL)
    ORDER BY b.contract_id, b.scheduled_start, b.id`;
  return rows.map((row) => ({
    bookingId: row.booking_id,
    contractId: row.contract_id,
    contractValue: Number(row.contract_value),
    vatAmount: Number(row.vat_amount),
    totalSessions: row.total_sessions,
    bonusSessions: row.bonus_sessions,
    commissionRate: row.commission_rate === null ? 100 : Number(row.commission_rate),
  }));
}

export type PendingAdjustment = {
  bookingId: string;
  contractId: string;
  trainerId: string;
  /** What the session was paid; the adjustment takes it back. */
  paid: number;
};

/**
 * The paid sessions deleted from the check-in history since, not yet taken back (D-027): a live SESSION line whose booking
 * is deleted from the history and has no live ADJUSTMENT line. Of one PT, or of every PT the branches cover.
 */
export async function pendingAdjustments(
  db: Db,
  branches: string[] | "ALL",
  trainerId: string | undefined,
): Promise<PendingAdjustment[]> {
  const rows = await db.$queryRaw<
    { booking_id: string; contract_id: string; trainer_id: string; amount: Prisma.Decimal }[]
  >`
    SELECT l.booking_id, l.contract_id, p.trainer_id, l.amount
    FROM pt_payout_lines l
    JOIN pt_payouts p ON p.id = l.payout_id
    JOIN bookings b ON b.id = l.booking_id
    WHERE l.kind = 'SESSION' AND l.released_at IS NULL
      AND b.history_deleted_at IS NOT NULL AND b.status = 'DELETED'
      AND NOT EXISTS (
        SELECT 1 FROM pt_payout_lines a
        WHERE a.booking_id = l.booking_id AND a.kind = 'ADJUSTMENT' AND a.released_at IS NULL)
      AND (${trainerId ?? null}::uuid IS NULL OR p.trainer_id = ${trainerId ?? null}::uuid)
      AND ${branchSql(Prisma.sql`p.branch_id`, branches)}
    ORDER BY b.history_deleted_at, l.booking_id`;
  return rows.map((row) => ({
    bookingId: row.booking_id,
    contractId: row.contract_id,
    trainerId: row.trainer_id,
    paid: Number(row.amount),
  }));
}

export type NewLine = { bookingId: string; contractId: string; kind: "SESSION" | "ADJUSTMENT"; amount: number };

export type NewPayout = {
  branchId: string;
  trainerId: string;
  periodFrom: Date;
  periodTo: Date;
  amount: number;
  sessionAmount: number;
  adjustmentAmount: number;
  sessionCount: number;
  adjustmentCount: number;
  cashTransactionId: string;
  idempotencyKey: string;
  createdById: string;
};

export async function createPayout(db: Db, data: NewPayout, lines: NewLine[]) {
  const payout = await db.ptPayout.create({ data, select: { id: true } });
  await db.ptPayoutLine.createMany({ data: lines.map((line) => ({ ...line, payoutId: payout.id })) });
  return payout.id;
}

const payoutInclude = {
  branch: { select: { id: true, name: true } },
  trainer: { select: { id: true, employeeCode: true, fullName: true } },
  createdBy: { select: { name: true } },
  cashTransaction: { select: { number: true, approvalStatus: true, deletedAt: true } },
} satisfies Prisma.PtPayoutInclude;
export type PayoutRecord = Prisma.PtPayoutGetPayload<{ include: typeof payoutInclude }>;

const detailInclude = {
  ...payoutInclude,
  lines: {
    orderBy: [{ kind: "asc" }, { booking: { scheduledStart: "asc" } }],
    include: {
      booking: {
        select: {
          id: true,
          scheduledStart: true,
          customer: { select: { id: true, customerCode: true, fullName: true } },
        },
      },
      contract: { select: { id: true, contractCode: true } },
    },
  },
} satisfies Prisma.PtPayoutInclude;
export type PayoutDetailRecord = Prisma.PtPayoutGetPayload<{ include: typeof detailInclude }>;

export async function listPayouts(
  db: Db,
  where: Prisma.PtPayoutWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: PayoutRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.ptPayout.findMany({
      where,
      include: payoutInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.ptPayout.count({ where }),
  ]);
  return { items, total };
}

export function findPayout(db: Db, where: Prisma.PtPayoutWhereInput): Promise<PayoutDetailRecord | null> {
  return db.ptPayout.findFirst({ where, include: detailInclude });
}

export function findPayoutByKey(db: Db, key: string): Promise<PayoutRecord | null> {
  return db.ptPayout.findUnique({ where: { idempotencyKey: key }, include: payoutInclude });
}
