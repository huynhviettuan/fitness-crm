// Pure class-schedule rules: no database, no framework (brief §6.4, D-031, BR-411).

export const CLASS_ATTENDANCE_STATUSES = ["ENROLLED", "PRESENT", "ABSENT"] as const;
export type ClassAttendanceStatus = (typeof CLASS_ATTENDANCE_STATUSES)[number];

export const CLASS_SESSION_STATUSES = ["SCHEDULED", "CANCELLED"] as const;
export type ClassSessionStatus = (typeof CLASS_SESSION_STATUSES)[number];

/** ISO weekdays, 1 = Monday … 7 = Sunday. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export { WEEKDAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

function isoWeekdayOf(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/**
 * The days a weekly class runs between `from` and `from + days - 1` (inclusive), as calendar days at UTC midnight,
 * oldest first (A-161).
 */
export function occurrenceDays(weekdays: readonly number[], from: Date, days: number): Date[] {
  const found: Date[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(from.getTime() + offset * DAY_MS);
    if (weekdays.includes(isoWeekdayOf(day))) found.push(day);
  }
  return found;
}

/** Seats left in a class session: enrolled and present customers hold a seat, absent ones do not (A-162). */
export function seatsLeft(capacity: number, seatsTaken: number): number {
  return Math.max(0, capacity - seatsTaken);
}

/**
 * A-162, OQ-008 interim for classes: a customer can be enrolled while the contract has more sessions left than
 * enrollments waiting to be marked.
 */
export function hasSessionForEnrollment(remainingSessions: number, openEnrollments: number): boolean {
  return openEnrollments < remainingSessions;
}

/** A-163: only an enrollment not yet marked can be removed or marked; a mark is final (as Đã tập, D-026). */
export function canMarkAttendance(status: string): boolean {
  return status === "ENROLLED";
}

export function canRemoveEnrollment(status: string): boolean {
  return status === "ENROLLED";
}

/** A-164: a class session counts as taught for the coach when at least one customer was present. */
export function isTaught(statuses: readonly string[]): boolean {
  return statuses.some((status) => status === "PRESENT");
}
