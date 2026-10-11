import type { LeadStatus } from "./lead.schema.js";

// The lead journey (brief §3, D-020; docs/02 flow 2). The flow is code (D-015); the
// re-care delay, refusal reasons, and colors are configuration.

/** Statuses a person in the LEAD stage can have; Show and Contracted belong to customers. */
export const BOARD_STATUSES = [
  "NEW",
  "CONSULTING",
  "CONSIDERING",
  "NO_RESPONSE",
  "BOOKED",
  "NO_SHOW",
  "REFUSED",
] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

/** Statuses a user sets by hand. New ends at assignment; Show and No show arrive with appointments (M2 slice 4). */
export const MANUAL_LEAD_STATUSES = ["CONSULTING", "CONSIDERING", "NO_RESPONSE", "BOOKED", "REFUSED"] as const;
export type ManualLeadStatus = (typeof MANUAL_LEAD_STATUSES)[number];

/** Never closed: they wait in the re-care queue with a contact-again date (BR-204). */
export const RECARE_STATUSES = ["NO_RESPONSE", "REFUSED", "NO_SHOW"] as const satisfies readonly LeadStatus[];

const NEXT: Record<LeadStatus, readonly ManualLeadStatus[]> = {
  // Assignment moves a new lead to Consulting.
  NEW: [],
  CONSULTING: ["CONSIDERING", "NO_RESPONSE", "BOOKED", "REFUSED"],
  CONSIDERING: ["CONSULTING", "NO_RESPONSE", "BOOKED", "REFUSED"],
  // Re-care brings them back to Consulting or an appointment (brief §3).
  NO_RESPONSE: ["CONSULTING", "BOOKED", "REFUSED"],
  // Booked again moves the appointment; the others call it off.
  BOOKED: ["BOOKED", "CONSULTING", "CONSIDERING", "NO_RESPONSE", "REFUSED"],
  NO_SHOW: ["CONSULTING", "BOOKED", "REFUSED"],
  REFUSED: ["CONSULTING", "BOOKED"],
  SHOWED: [],
  CONTRACTED: [],
};

/** The statuses a user may move a lead to from `from`. */
export function nextLeadStatuses(from: LeadStatus): readonly ManualLeadStatus[] {
  return NEXT[from];
}

export function canChangeLeadStatus(from: LeadStatus, to: LeadStatus): boolean {
  return (NEXT[from] as readonly LeadStatus[]).includes(to);
}

export function isRecareStatus(status: LeadStatus): boolean {
  return (RECARE_STATUSES as readonly LeadStatus[]).includes(status);
}

const DAY_MS = 86_400_000;

/**
 * The next day to contact a lead in re-care (BR-204, A-062): `recareDays` after the gym's
 * today, every time they enter or stay in re-care. `today` is a date at UTC midnight.
 */
export function nextContactAgainOn(today: Date, recareDays: number): Date {
  return new Date(today.getTime() + recareDays * DAY_MS);
}

/** A lead is overdue when its contact-again day is before the gym's today (FR-LEAD-007); both are dates at UTC midnight. */
export function isRecareOverdue(contactAgainOn: Date | null, today: Date): boolean {
  return contactAgainOn !== null && contactAgainOn.getTime() < today.getTime();
}
