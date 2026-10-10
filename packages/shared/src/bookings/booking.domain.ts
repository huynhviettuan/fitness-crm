// Pure booking rules: no database, no framework. The API enforces them; the web app
// uses them to show only the actions that can succeed.

/** The booking owns the single lifecycle status (T-011); matches the database enum. */
export const BOOKING_STATUSES = ["BOOKED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** A-005: these statuses hold the trainer's time slot (BR-010). */
export const ACTIVE_BOOKING_STATUSES = ["BOOKED", "CHECKED_IN", "COMPLETED"] as const satisfies readonly BookingStatus[];

/** OQ-008 interim: bookings that will still use one of the contract's sessions. */
export const OPEN_BOOKING_STATUSES = ["BOOKED", "CHECKED_IN"] as const satisfies readonly BookingStatus[];

export function isActiveBooking(status: BookingStatus): boolean {
  return (ACTIVE_BOOKING_STATUSES as readonly BookingStatus[]).includes(status);
}

// Allowed actions per status (A-006, docs/02 Flow 2).

export function canReschedule(status: BookingStatus): boolean {
  return status === "BOOKED";
}

export function canCheckIn(status: BookingStatus): boolean {
  return status === "BOOKED";
}

/** Only from CHECKED_IN until OQ-002 decides whether BOOKED may be completed directly. */
export function canComplete(status: BookingStatus): boolean {
  return status === "CHECKED_IN";
}

/** CHECKED_IN → CANCELLED is the exceptional cancel. */
export function canCancelBooking(status: BookingStatus): boolean {
  return status === "BOOKED" || status === "CHECKED_IN";
}

export function canMarkNoShow(status: BookingStatus): boolean {
  return status === "BOOKED";
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
