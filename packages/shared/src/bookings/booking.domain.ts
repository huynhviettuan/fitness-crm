// Pure booking rules: no database, no framework. The API enforces them; the web app
// uses them to show only the actions that can succeed.

/**
 * The statuses the system itself knows (D-025, M5.1). Their rules (consumes, credits the PT, color) are configuration
 * in `session_statuses`; the database holds the codes, so a status added later is a row, not a migration.
 */
export const BOOKING_STATUSES = ["BOOKED", "TRAINED", "CANCELLED", "NO_SHOW", "DELETED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** OQ-008 interim: bookings that will still use one of the contract's sessions. */
export const OPEN_BOOKING_STATUSES = ["BOOKED"] as const satisfies readonly BookingStatus[];

/** The colors a status rule may take: the design tokens of the status badge (docs/23 §3). */
export const STATUS_COLORS = ["success", "warning", "info", "muted", "destructive"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

/**
 * What decides the actions on a booking: its status, and whether the customer checked in (a session record exists).
 * There is no separate "checked in" status (D-025); it is a fact on a Booked session.
 */
export type BookingFacts = { status: string; checkedIn: boolean };

// Allowed actions (A-006, docs/02 Flow 2, D-026).

export function canReschedule({ status, checkedIn }: BookingFacts): boolean {
  return status === "BOOKED" && !checkedIn;
}

export function canCheckIn({ status, checkedIn }: BookingFacts): boolean {
  return status === "BOOKED" && !checkedIn;
}

/** D-026: there is no separate check-in step, so a Booked session is completed directly, checked in or not. */
export function canComplete({ status }: BookingFacts): boolean {
  return status === "BOOKED";
}

/** Xóa: a session booked by mistake, still Booked and not checked in (M5.3). */
export function canDeleteBooking({ status, checkedIn }: BookingFacts): boolean {
  return status === "BOOKED" && !checkedIn;
}

/** D-026: only a trained session is corrected from the check-in history; it is the one status that locks. */
export function canDeleteFromHistory({ status }: BookingFacts): boolean {
  return status === "TRAINED";
}

/** A checked-in session may still be cancelled: the exceptional cancel. */
export function canCancelBooking({ status }: BookingFacts): boolean {
  return status === "BOOKED";
}

export function canMarkNoShow({ status, checkedIn }: BookingFacts): boolean {
  return status === "BOOKED" && !checkedIn;
}

/**
 * BR-012, OQ-001 interim: the session's day (in the gym timezone) must fall within the
 * contract's start and end dates. All dates are calendar days at UTC midnight.
 */
export function isWithinContractPeriod(sessionDay: Date, contract: { startDate: Date; endDate: Date }): boolean {
  return sessionDay.getTime() >= contract.startDate.getTime() && sessionDay.getTime() <= contract.endDate.getTime();
}

/**
 * OQ-008 interim: a new booking needs a remaining session that is not already
 * promised to an open booking.
 */
export function hasSessionForNewBooking(remainingSessions: number, openBookings: number): boolean {
  return openBookings < remainingSessions;
}
