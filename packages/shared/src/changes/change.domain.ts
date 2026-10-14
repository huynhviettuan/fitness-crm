import { endDateOf } from "../services/service.domain.js";

// Contract change vouchers (M8, brief §5.6, FR-CHG-001, FR-CHG-002, D-024; A-219 to A-226): pure rules. Each kind is its own
// voucher linked to the original contract; its effect on the contract is derived from the approved vouchers, never typed.

const DAY_MS = 86_400_000;

export const VOUCHER_KINDS = [
  "RENEWAL",
  "UPGRADE",
  "HOLD",
  "TRANSFER",
  "BRANCH_TRANSFER",
  "CONVERSION",
  "CANCELLATION",
] as const;
export type VoucherKind = (typeof VOUCHER_KINDS)[number];

/** A voucher waits (and has no effect), is approved (and has its effect), or is rejected (D-018). */
export const VOUCHER_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/** The approval action of each kind, so Admin switches each on or off and picks its approvers (D-018, OQ-023). */
export const VOUCHER_ACTIONS = {
  RENEWAL: "voucher.renewal",
  UPGRADE: "voucher.upgrade",
  HOLD: "voucher.hold",
  TRANSFER: "voucher.transfer",
  BRANCH_TRANSFER: "voucher.branchTransfer",
  CONVERSION: "voucher.conversion",
  CANCELLATION: "voucher.cancellation",
} as const satisfies Record<VoucherKind, string>;

/** A change is made to a contract that is approved and running; an ended, frozen, pending or cancelled one has none to change. */
export function canChangeContract(status: string): boolean {
  return status === "ACTIVE";
}

/** The days a hold covers, both ends counted (a hold from 10/11 to 12/11 is 3 days). */
export function holdDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

export type DayRange = { from: Date; to: Date };

/** Whether two ranges of days share a day. */
export function rangesOverlap(a: DayRange, b: DayRange): boolean {
  return a.from.getTime() <= b.to.getTime() && b.from.getTime() <= a.to.getTime();
}

/** Whether `day` is in one of the ranges. */
export function isInRanges(ranges: readonly DayRange[], day: Date): boolean {
  return ranges.some((range) => range.from.getTime() <= day.getTime() && day.getTime() <= range.to.getTime());
}

/** The end date once a hold's days are added back (the end date moves by the days held, brief §5.6). */
export function endDateAfterHold(endDate: Date, days: number): Date {
  return new Date(endDate.getTime() + days * DAY_MS);
}

/**
 * The period a renewal adds (A-220): it starts on the day asked, or the day after the contract ends (today when it has
 * ended), runs the months and days (the start day counts, A-108), and moves the end date to its last day when that is later.
 * A renewal of sessions only adds none to the dates.
 */
export function renewalPeriod(input: { endDate: Date; today: Date; from: Date | null; months: number; days: number }): {
  from: Date;
  to: Date | null;
  newEndDate: Date;
} {
  const dayAfterEnd = new Date(input.endDate.getTime() + DAY_MS);
  const from = input.from ?? (dayAfterEnd.getTime() >= input.today.getTime() ? dayAfterEnd : input.today);
  if (input.months === 0 && input.days === 0) return { from, to: null, newEndDate: input.endDate };
  const to = endDateOf(from, input.months, input.days);
  return { from, to, newEndDate: to.getTime() > input.endDate.getTime() ? to : input.endDate };
}
