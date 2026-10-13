/**
 * Fingerprint-ready check-in (M5.3b, brief §6.6, D-069 to D-072): the pairing rules as pure functions. The values
 * (15 minutes to wait, a window of 1 hour) are parameters and arrive as arguments (D-015).
 */

export const SCAN_RESULTS = ["WAITING", "PAIRED", "ERROR", "REPEAT"] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

/** Why a scan could not serve a session (D-070). The contract codes are the booking errors of the same name. */
export const SCAN_ERROR_CODES = [
  "UNKNOWN_USER",
  "NO_BOOKING",
  "PAIR_TOO_LATE",
  "CONTRACT_NOT_ACTIVE",
  "CONTRACT_FROZEN",
  "CONTRACT_NO_REMAINING_SESSIONS",
  "BOOKING_OUTSIDE_CONTRACT_PERIOD",
] as const;
export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number];

export type PairingRules = { waitMinutes: number; windowMinutes: number };

/** A booked, unconfirmed session a scan could serve. `otherScanAt` is the other side's scan, when it came already. */
export type PairCandidate = { id: string; start: Date; end: Date; otherScanAt: Date | null };

const MINUTE = 60_000;

/** A pair must fall between `window` before the start and `window` after the end of the booked session (D-070). */
export function isInWindow(scannedAt: Date, candidate: Pick<PairCandidate, "start" | "end">, windowMinutes: number) {
  return (
    scannedAt.getTime() >= candidate.start.getTime() - windowMinutes * MINUTE &&
    scannedAt.getTime() <= candidate.end.getTime() + windowMinutes * MINUTE
  );
}

/** The two sides of a pair must scan within the waiting time of each other (D-070). */
export function isPairedInTime(first: Date, second: Date, waitMinutes: number): boolean {
  return Math.abs(first.getTime() - second.getTime()) <= waitMinutes * MINUTE;
}

/**
 * The session a scan serves (D-070): among the candidates whose window holds the scan, one whose other side scanned
 * in time comes first, then the nearest start. A scan serves one session only. Null when none fits.
 */
export function pickCandidate(
  candidates: readonly PairCandidate[],
  scannedAt: Date,
  rules: PairingRules,
): PairCandidate | null {
  const fitting = candidates.filter((candidate) => isInWindow(scannedAt, candidate, rules.windowMinutes));
  const waiting = (candidate: PairCandidate) =>
    candidate.otherScanAt !== null && isPairedInTime(candidate.otherScanAt, scannedAt, rules.waitMinutes);
  const distance = (candidate: PairCandidate) => Math.abs(candidate.start.getTime() - scannedAt.getTime());
  return (
    [...fitting].sort(
      (a, b) =>
        Number(waiting(b)) - Number(waiting(a)) ||
        distance(a) - distance(b) ||
        a.start.getTime() - b.start.getTime() ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

export type HangingReason = "PT_MISSING" | "CUSTOMER_MISSING";

/**
 * A session hangs when one side scanned and the waiting time has passed without the other (D-070): "Thiếu check-in của
 * PT" when only the customer scanned, "Thiếu check-in của khách" when only the PT did. A session nobody scanned for is
 * not hanging; it simply waits for the admin (D-026).
 */
export function hangingReason(
  scans: { customerScanAt: Date | null; ptScanAt: Date | null },
  now: Date,
  waitMinutes: number,
): HangingReason | null {
  const { customerScanAt, ptScanAt } = scans;
  if ((customerScanAt === null) === (ptScanAt === null)) return null;
  const first = (customerScanAt ?? ptScanAt) as Date;
  if (now.getTime() <= first.getTime() + waitMinutes * MINUTE) return null;
  return customerScanAt ? "PT_MISSING" : "CUSTOMER_MISSING";
}

/** Whether a machine's clock is off by more than the tolerance (D-072). */
export function isClockOff(offsetSeconds: number | null, toleranceSeconds: number): boolean {
  return offsetSeconds !== null && Math.abs(offsetSeconds) > toleranceSeconds;
}
