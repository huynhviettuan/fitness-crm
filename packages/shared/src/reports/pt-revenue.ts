import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { periodReportQuerySchema } from "../finance/cash-book.js";
import { instant } from "../validation/index.js";

// The PT revenue allocation report (brief §6.5, §9, D-032, FR-PT-007; A-166 to A-170). The formulas live here so the
// API, the Excel export, and the tests share one copy (docs/10 "Data consistency").

/**
 * The part of a contract's value that is shared across its sessions: the value after discounts, excluding VAT, until
 * OQ-022 says otherwise (A-026). The contract value already has the discounts and the VAT in it.
 */
export function allocationValueOf(contractValue: number, vatAmount: number): number {
  return Math.max(0, contractValue - vatAmount);
}

/** Sessions bought plus bonus sessions: what the allocation value is divided across (D-032). */
export function entitledSessions(bought: number, bonus: number): number {
  return bought + bonus;
}

/** The allocation value ÷ sessions, to the dong; shown on the report, never summed. */
export function allocationPerSession(allocationValue: number, sessions: number): number {
  return sessions > 0 ? Math.round(allocationValue / sessions) : 0;
}

/** A rate in percent with at most two decimals, as whole hundredths of a percent. */
function hundredths(rate: number): bigint {
  return BigInt(Math.round(rate * 100));
}

/**
 * The PT allocation of one PT on one contract: credited × (allocation value ÷ sessions) × commission rate × timesheet
 * rate (D-032). It is worked out from the exact fraction, so the rows add up to the right total, and rounded once, to
 * the dong, half up. The arithmetic is in whole numbers, because a contract value times two rates passes what a
 * floating-point number holds exactly.
 */
export function ptAllocation(input: {
  credited: number;
  allocationValue: number;
  sessions: number;
  /** Percent, from the service. */
  commissionRate: number;
  /** Percent, from the parameter. */
  timesheetRate: number;
}): number {
  if (input.sessions <= 0 || input.credited <= 0 || input.allocationValue <= 0) return 0;
  const numerator =
    BigInt(input.credited) *
    BigInt(input.allocationValue) *
    hundredths(input.commissionRate) *
    hundredths(input.timesheetRate);
  const denominator = BigInt(input.sessions) * 100_000_000n;
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/**
 * Whether a session started inside the PT's on-duty shift of that day (D-058). `minute` is the minute of the gym's day
 * the session started; a shift counts from its first minute up to, not including, its last. A day off is outside.
 */
export function startsInShift(
  shifts: readonly { weekday: number; startMinute: number; endMinute: number }[],
  weekday: number,
  minute: number,
  dayOff = false,
): boolean {
  if (dayOff) return false;
  return shifts.some((shift) => shift.weekday === weekday && minute >= shift.startMinute && minute < shift.endMinute);
}

/** The period, branch, and PT a report is about. */
export const ptRevenueQuerySchema = periodReportQuerySchema.extend({
  trainerId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "invalidChoice" }).optional()),
});

export type PtRevenueQuery = z.input<typeof ptRevenueQuerySchema>;

/** One PT on one contract in the period: a row of GymMaster's "employee_pt_training" (D-032). */
export const ptRevenueRowSchema = z.object({
  customer: z.object({
    id: z.uuid(),
    customerCode: z.string(),
    fullName: z.string(),
    /** Empty when the role has phones hidden (D-017). */
    phone: z.string().nullable(),
  }),
  branch: branchRefSchema,
  contract: z.object({
    id: z.uuid(),
    contractCode: z.string(),
    service: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    contractType: z.enum(["NEW", "RENEW"]),
    contractValue: z.int(),
    note: z.string().nullable(),
  }),
  /** Contract value after discounts, excluding VAT (A-026). */
  allocationValue: z.int(),
  /** Sessions bought plus bonus. */
  sessions: z.int(),
  allocationPerSession: z.int(),
  /** Sessions of this PT on this contract in the period that credit the PT ("Show dạy"). */
  credited: z.int(),
  /** Of those, the ones that started inside and outside the PT's on-duty shift (D-058). */
  inShift: z.int(),
  outsideShift: z.int(),
  /** Percent. */
  commissionRate: z.number(),
  timesheetRate: z.number(),
  allocation: z.int(),
  /** Of the credited sessions, the ones a payout already paid (M5.7). */
  paidSessions: z.int(),
  /** The allocation of the credited sessions not paid yet. */
  payable: z.int(),
  /** Negative: paid sessions of this contract deleted from the history since, taken back in the PT's next payout (D-027). */
  adjustments: z.int(),
});

/** One PT: their rows, and the totals of the rows. */
export const ptRevenueTrainerSchema = z.object({
  employee: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }),
  rows: z.array(ptRevenueRowSchema),
  /** All sessions of the PT in the period that credit the PT, whatever the contract. */
  credited: z.int(),
  inShift: z.int(),
  outsideShift: z.int(),
  /** Class sessions the PT taught with at least one customer present (A-164); no revenue is allocated to them. */
  classSessions: z.int(),
  allocation: z.int(),
  /** What a payout would pay now: the unpaid allocation plus the pending adjustments (A-173). */
  payable: z.int(),
  /** Every pending adjustment of the PT, on whatever contract (D-027). */
  adjustments: z.int(),
});

export const ptRevenueReportSchema = z
  .object({
    from: instant,
    to: instant,
    trainers: z.array(ptRevenueTrainerSchema),
    totals: z.object({
      credited: z.int(),
      classSessions: z.int(),
      allocation: z.int(),
      payable: z.int(),
      adjustments: z.int(),
    }),
  })
  .meta({ id: "PtRevenueReport" });

export type PtRevenueRow = z.output<typeof ptRevenueRowSchema>;
export type PtRevenueTrainer = z.output<typeof ptRevenueTrainerSchema>;
export type PtRevenueReport = z.output<typeof ptRevenueReportSchema>;
