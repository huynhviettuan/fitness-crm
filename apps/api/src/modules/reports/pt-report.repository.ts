import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { branchSql } from "./report-scope.js";

// The queries behind the PT revenue allocation report, the booking report, and the overview dashboard (M5.6, A-166 to
// A-172). A session belongs to the gym day it was scheduled for (A-168); the flags stored on each session decide what
// credits the PT and what uses a session (T-050), so a session deleted from the history drops out by itself.

type Period = { from: Date; to: Date };

export type CreditedRow = {
  trainerId: string;
  employeeCode: string;
  trainerName: string;
  contractId: string;
  contractCode: string;
  contractType: "NEW" | "RENEW";
  contractValue: number;
  vatAmount: number;
  totalSessions: number;
  bonusSessions: number;
  note: string | null;
  branchId: string;
  branchName: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  phone: string | null;
  serviceId: string | null;
  serviceName: string | null;
  commissionRate: number;
  credited: number;
  inShift: number;
  /** Of the credited sessions, the ones a standing payout already paid (M5.7). */
  paid: number;
};

/** The gym day of a moment, in SQL. */
function gymDay(column: Prisma.Sql, timeZone: string): Prisma.Sql {
  return Prisma.sql`(${column} AT TIME ZONE ${timeZone}::text)::date`;
}

/**
 * The sessions that credit a PT in the period, per PT and contract, and how many of them started inside the PT's
 * on-duty shift of that day (D-058): a shift of that weekday holds the minute of the day, and the day is not a day off.
 */
export async function creditedRows(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  timeZone: string,
  trainerId: string | undefined,
): Promise<CreditedRow[]> {
  const day = gymDay(Prisma.sql`b.scheduled_start`, timeZone);
  const local = Prisma.sql`(b.scheduled_start AT TIME ZONE ${timeZone}::text)`;
  const rows = await db.$queryRaw<
    {
      trainer_id: string;
      employee_code: string;
      trainer_name: string;
      contract_id: string;
      contract_code: string;
      contract_type: "NEW" | "RENEW";
      contract_value: Prisma.Decimal;
      vat_amount: Prisma.Decimal;
      total_sessions: number;
      bonus_sessions: number;
      notes: string | null;
      branch_id: string;
      branch_name: string;
      customer_id: string;
      customer_code: string | null;
      customer_name: string;
      phone: string | null;
      service_id: string | null;
      service_name: string | null;
      commission_rate: Prisma.Decimal | null;
      credited: bigint;
      in_shift: bigint;
      paid: bigint;
    }[]
  >`
    SELECT b.trainer_id, e.employee_code, e.full_name AS trainer_name,
           c.id AS contract_id, c.contract_code, c.contract_type, c.contract_value, c.vat_amount,
           c.total_sessions, c.bonus_sessions, c.notes,
           c.branch_id, br.name AS branch_name,
           cu.id AS customer_id, cu.customer_code, cu.full_name AS customer_name, cu.phone,
           s.id AS service_id, s.name AS service_name, s.commission_rate,
           COUNT(*) AS credited,
           COUNT(*) FILTER (WHERE
             EXISTS (
               SELECT 1 FROM employee_shifts sh
               WHERE sh.employee_id = b.trainer_id
                 AND sh.weekday = EXTRACT(ISODOW FROM ${local})::int
                 AND EXTRACT(HOUR FROM ${local}) * 60 + EXTRACT(MINUTE FROM ${local}) >= sh.start_minute
                 AND EXTRACT(HOUR FROM ${local}) * 60 + EXTRACT(MINUTE FROM ${local}) < sh.end_minute)
             AND NOT EXISTS (
               SELECT 1 FROM employee_days_off d WHERE d.employee_id = b.trainer_id AND d.date = ${day})
           ) AS in_shift,
           COUNT(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM pt_payout_lines l
             WHERE l.booking_id = b.id AND l.kind = 'SESSION' AND l.released_at IS NULL)) AS paid
    FROM bookings b
    JOIN employees e ON e.id = b.trainer_id
    JOIN contracts c ON c.id = b.contract_id
    JOIN customers cu ON cu.id = b.customer_id
    JOIN branches br ON br.id = c.branch_id
    LEFT JOIN services s ON s.id = c.service_id
    WHERE b.credits_pt
      AND ${day} >= ${period.from}::date AND ${day} <= ${period.to}::date
      AND ${branchSql(Prisma.sql`b.branch_id`, branches)}
      AND (${trainerId ?? null}::uuid IS NULL OR b.trainer_id = ${trainerId ?? null}::uuid)
    GROUP BY b.trainer_id, e.employee_code, e.full_name, c.id, br.name, cu.id, s.id`;
  return rows.map((row) => ({
    trainerId: row.trainer_id,
    employeeCode: row.employee_code,
    trainerName: row.trainer_name,
    contractId: row.contract_id,
    contractCode: row.contract_code,
    contractType: row.contract_type,
    contractValue: Number(row.contract_value),
    vatAmount: Number(row.vat_amount),
    totalSessions: row.total_sessions,
    bonusSessions: row.bonus_sessions,
    note: row.notes,
    branchId: row.branch_id,
    branchName: row.branch_name,
    customerId: row.customer_id,
    customerCode: row.customer_code ?? "",
    customerName: row.customer_name,
    phone: row.phone,
    serviceId: row.service_id,
    serviceName: row.service_name,
    // A contract brought over from before the services has none: the rate every service starts with (A-167).
    commissionRate: row.commission_rate === null ? 100 : Number(row.commission_rate),
    credited: Number(row.credited),
    inShift: Number(row.in_shift),
    paid: Number(row.paid),
  }));
}

export type TaughtClassRow = { coachId: string; employeeCode: string; coachName: string; sessions: number };

/** The class sessions in the period with at least one customer present, per coach (A-164). */
export async function taughtClasses(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  timeZone: string,
  trainerId: string | undefined,
): Promise<TaughtClassRow[]> {
  const day = gymDay(Prisma.sql`cs.starts_at`, timeZone);
  const rows = await db.$queryRaw<{ coach_id: string; employee_code: string; coach_name: string; sessions: bigint }[]>`
    SELECT cs.coach_id, e.employee_code, e.full_name AS coach_name, COUNT(*) AS sessions
    FROM class_sessions cs
    JOIN employees e ON e.id = cs.coach_id
    WHERE cs.status = 'SCHEDULED'
      AND EXISTS (SELECT 1 FROM class_attendances a WHERE a.class_session_id = cs.id AND a.status = 'PRESENT')
      AND ${day} >= ${period.from}::date AND ${day} <= ${period.to}::date
      AND ${branchSql(Prisma.sql`cs.branch_id`, branches)}
      AND (${trainerId ?? null}::uuid IS NULL OR cs.coach_id = ${trainerId ?? null}::uuid)
    GROUP BY cs.coach_id, e.employee_code, e.full_name`;
  return rows.map((row) => ({
    coachId: row.coach_id,
    employeeCode: row.employee_code,
    coachName: row.coach_name,
    sessions: Number(row.sessions),
  }));
}

export type OverviewFigures = {
  newLeads: number;
  convertedLeads: number;
  membersTraining: number;
  activePts: number;
  endingSoon: number;
};

/** The counts of the overview dashboard (A-172): leads, members training, PTs, and contracts ending soon. */
export async function overviewFigures(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  timeZone: string,
  running: { today: Date; expiringSoonDays: number; runningOutSessions: number },
): Promise<OverviewFigures> {
  const leadDay = gymDay(Prisma.sql`cu.created_at`, timeZone);
  const bookingDay = gymDay(Prisma.sql`b.scheduled_start`, timeZone);
  const classDay = gymDay(Prisma.sql`cs.starts_at`, timeZone);
  const [leads, training, pts, ending] = await Promise.all([
    db.$queryRaw<{ new_leads: bigint; converted: bigint }[]>`
      SELECT COUNT(*) AS new_leads,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM contracts k
               WHERE k.customer_id = cu.id AND k.deleted_at IS NULL AND k.status IN ('ACTIVE', 'FROZEN'))) AS converted
      FROM customers cu
      WHERE cu.lead_code IS NOT NULL
        AND ${leadDay} >= ${period.from}::date AND ${leadDay} <= ${period.to}::date
        AND ${branchSql(Prisma.sql`cu.branch_id`, branches)}`,
    db.$queryRaw<{ members: bigint }[]>`
      SELECT COUNT(DISTINCT t.customer_id) AS members FROM (
        SELECT b.customer_id FROM bookings b
        WHERE b.consumes
          AND ${bookingDay} >= ${period.from}::date AND ${bookingDay} <= ${period.to}::date
          AND ${branchSql(Prisma.sql`b.branch_id`, branches)}
        UNION ALL
        SELECT a.customer_id FROM class_attendances a
        JOIN class_sessions cs ON cs.id = a.class_session_id
        WHERE a.consumes
          AND ${classDay} >= ${period.from}::date AND ${classDay} <= ${period.to}::date
          AND ${branchSql(Prisma.sql`cs.branch_id`, branches)}
      ) t`,
    db.$queryRaw<{ pts: bigint }[]>`
      SELECT COUNT(*) AS pts FROM employees e
      WHERE e.is_trainer AND e.status = 'ACTIVE' AND ${branchSql(Prisma.sql`e.branch_id`, branches)}`,
    db.$queryRaw<{ ending: bigint }[]>`
      SELECT COUNT(*) AS ending FROM contracts c
      WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE' AND c.end_date >= ${running.today}::date
        AND ${branchSql(Prisma.sql`c.branch_id`, branches)}
        AND (
          c.end_date <= ${running.today}::date + ${running.expiringSoonDays}::int
          OR c.total_sessions + c.bonus_sessions - c.opening_sessions_used
             - (SELECT COUNT(*) FROM bookings k WHERE k.contract_id = c.id AND k.consumes)
             - (SELECT COUNT(*) FROM class_attendances a WHERE a.contract_id = c.id AND a.consumes)
             <= ${running.runningOutSessions}::int)`,
  ]);
  return {
    newLeads: Number(leads[0]?.new_leads ?? 0),
    convertedLeads: Number(leads[0]?.converted ?? 0),
    membersTraining: Number(training[0]?.members ?? 0),
    activePts: Number(pts[0]?.pts ?? 0),
    endingSoon: Number(ending[0]?.ending ?? 0),
  };
}

/** The sessions that credited a PT in the period, by the hour of the gym's day they started. */
export async function sessionsByHour(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
  timeZone: string,
): Promise<{ hour: number; sessions: number }[]> {
  const day = gymDay(Prisma.sql`b.scheduled_start`, timeZone);
  const rows = await db.$queryRaw<{ hour: number; sessions: bigint }[]>`
    SELECT EXTRACT(HOUR FROM (b.scheduled_start AT TIME ZONE ${timeZone}::text))::int AS hour, COUNT(*) AS sessions
    FROM bookings b
    WHERE b.credits_pt
      AND ${day} >= ${period.from}::date AND ${day} <= ${period.to}::date
      AND ${branchSql(Prisma.sql`b.branch_id`, branches)}
    GROUP BY 1`;
  return rows.map((row) => ({ hour: row.hour, sessions: Number(row.sessions) }));
}

/** The valid receipts by month from `from` to `to` (D-011: no opening balances; D-018: approved only). */
export async function revenueByMonth(
  db: Db,
  branches: string[] | "ALL",
  period: Period,
): Promise<{ month: string; revenue: number }[]> {
  const rows = await db.$queryRaw<{ month: string; revenue: Prisma.Decimal }[]>`
    SELECT to_char(date_trunc('month', p.paid_on), 'YYYY-MM') AS month, SUM(p.amount) AS revenue
    FROM payments p
    WHERE p.deleted_at IS NULL AND p.approval_status = 'APPROVED'
      AND p.paid_on >= ${period.from}::date AND p.paid_on <= ${period.to}::date
      AND ${branchSql(Prisma.sql`p.branch_id`, branches)}
    GROUP BY 1`;
  return rows.map((row) => ({ month: row.month, revenue: Number(row.revenue) }));
}

const reportInclude = {
  customer: { select: { id: true, customerCode: true, fullName: true, phone: true } },
  contract: { select: { id: true, contractCode: true } },
  branch: { select: { id: true, name: true } },
  trainer: { select: { id: true, employeeCode: true, fullName: true } },
  statusRule: { select: { code: true, labelVi: true, labelEn: true, color: true } },
  session: { select: { checkedInAt: true, completedAt: true } },
} satisfies Prisma.BookingInclude;
export type BookingReportRecord = Prisma.BookingGetPayload<{ include: typeof reportInclude }>;

/** One page of the booking report, with the rows of the filter counted. */
export async function bookingReportPage(
  db: Db,
  where: Prisma.BookingWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: BookingReportRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: reportInclude,
      orderBy: [{ scheduledStart: "desc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.booking.count({ where }),
  ]);
  return { items, total };
}
