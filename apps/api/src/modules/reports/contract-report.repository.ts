import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { branchSql } from "./report-scope.js";

// The contract report and the exception-price report (M4.7, A-140, A-141). An approved contract is one that is active
// or frozen (expiry is derived, A-135); drafts, rejected and deleted contracts have no effect (D-018, D-035).

export type ContractGroupRow = {
  serviceId: string | null;
  serviceName: string | null;
  minSessions: number | null;
  maxSessions: number | null;
  newContracts: number;
  renewedContracts: number;
  value: number;
  revenue: number;
  debt: number;
  expiringSoon: number;
  runningOut: number;
};

type Period = { from: Date; to: Date };

/**
 * Per service and session-tier band. New, renewed, value and debt are the contracts dated in the period; revenue is
 * the valid receipts received in the period on any contract of the group (cancelled ones keep what was paid);
 * expiring and running out look at the contracts running today.
 */
export async function contractGroups(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  running: { today: Date; expiringSoonDays: number; runningOutSessions: number },
): Promise<ContractGroupRow[]> {
  const inPeriod = Prisma.sql`b.contract_date >= ${period.from}::date AND b.contract_date <= ${period.to}::date`;
  const approved = Prisma.sql`b.status IN ('ACTIVE', 'FROZEN')`;
  const rows = await db.$queryRaw<
    {
      service_id: string | null;
      service_name: string | null;
      min_sessions: number | null;
      max_sessions: number | null;
      new_contracts: bigint;
      renewed_contracts: bigint;
      value: Prisma.Decimal;
      revenue: Prisma.Decimal;
      debt: Prisma.Decimal;
      expiring_soon: bigint;
      running_out: bigint;
    }[]
  >`
    WITH base AS (
      SELECT c.service_id, t.min_sessions, t.max_sessions, c.contract_type, c.status, c.contract_date, c.end_date,
             c.contract_value, c.opening_paid_amount, c.opening_sessions_used,
             c.total_sessions + c.bonus_sessions AS entitled,
             COALESCE(paid.total, 0) AS paid, COALESCE(paid.received, 0) AS received,
             (SELECT COUNT(*) FROM bookings k WHERE k.contract_id = c.id AND k.consumes)
               + (SELECT COUNT(*) FROM class_attendances a WHERE a.contract_id = c.id AND a.consumes) AS completed
      FROM contracts c
      LEFT JOIN price_tiers t ON t.id = c.price_tier_id
      LEFT JOIN LATERAL (
        SELECT SUM(p.amount) AS total,
               SUM(p.amount) FILTER (WHERE p.paid_on >= ${period.from}::date AND p.paid_on <= ${period.to}::date) AS received
        FROM payments p
        WHERE p.contract_id = c.id AND p.deleted_at IS NULL AND p.approval_status = 'APPROVED'
      ) paid ON TRUE
      WHERE c.deleted_at IS NULL AND c.status IN ('ACTIVE', 'FROZEN', 'CANCELLED')
        AND ${branchSql(Prisma.sql`c.branch_id`, branches)}
    )
    SELECT b.service_id, s.name AS service_name, b.min_sessions, b.max_sessions,
      COUNT(*) FILTER (WHERE ${approved} AND b.contract_type = 'NEW' AND ${inPeriod}) AS new_contracts,
      COUNT(*) FILTER (WHERE ${approved} AND b.contract_type = 'RENEW' AND ${inPeriod}) AS renewed_contracts,
      COALESCE(SUM(b.contract_value) FILTER (WHERE ${approved} AND ${inPeriod}), 0) AS value,
      COALESCE(SUM(b.received), 0) AS revenue,
      COALESCE(SUM(b.contract_value - b.opening_paid_amount - b.paid) FILTER (WHERE ${approved} AND ${inPeriod}), 0) AS debt,
      COUNT(*) FILTER (WHERE b.status = 'ACTIVE' AND b.end_date >= ${running.today}::date
        AND b.end_date <= ${running.today}::date + ${running.expiringSoonDays}::int) AS expiring_soon,
      COUNT(*) FILTER (WHERE b.status = 'ACTIVE' AND b.end_date >= ${running.today}::date
        AND b.entitled - b.opening_sessions_used - b.completed <= ${running.runningOutSessions}::int) AS running_out
    FROM base b
    LEFT JOIN services s ON s.id = b.service_id
    GROUP BY b.service_id, s.name, b.min_sessions, b.max_sessions`;
  return rows.map((row) => ({
    serviceId: row.service_id,
    serviceName: row.service_name,
    minSessions: row.min_sessions,
    maxSessions: row.max_sessions,
    newContracts: Number(row.new_contracts),
    renewedContracts: Number(row.renewed_contracts),
    value: Number(row.value),
    revenue: Number(row.revenue),
    debt: Number(row.debt),
    expiringSoon: Number(row.expiring_soon),
    runningOut: Number(row.running_out),
  }));
}

export type ExceptionGroupRow = {
  userId: string;
  name: string;
  contracts: number;
  exceptions: number;
  difference: number;
};

/**
 * Approved contracts dated in the period, per creator or per approver: how many, how many with an exception price,
 * and the tier price less the approved price over the sessions bought (BR-302). Contracts brought over from before the
 * tiers have no tier price and are left out.
 */
export async function exceptionGroups(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  by: "created_by" | "approved_by",
): Promise<ExceptionGroupRow[]> {
  const column = Prisma.raw(`c.${by}`);
  const rows = await db.$queryRaw<
    { user_id: string; name: string; contracts: bigint; exceptions: bigint; difference: Prisma.Decimal }[]
  >`
    SELECT u.id AS user_id, u.name,
           COUNT(*) AS contracts,
           COUNT(*) FILTER (WHERE c.is_exception_price) AS exceptions,
           COALESCE(SUM((c.tier_unit_price - c.approved_unit_price) * c.total_sessions)
             FILTER (WHERE c.is_exception_price AND c.tier_unit_price IS NOT NULL), 0) AS difference
    FROM contracts c
    JOIN users u ON u.id = ${column}
    WHERE c.deleted_at IS NULL AND c.status IN ('ACTIVE', 'FROZEN') AND NOT c.is_imported
      AND c.contract_date >= ${period.from}::date AND c.contract_date <= ${period.to}::date
      AND ${branchSql(Prisma.sql`c.branch_id`, branches)}
    GROUP BY u.id, u.name`;
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    contracts: Number(row.contracts),
    exceptions: Number(row.exceptions),
    difference: Number(row.difference),
  }));
}
