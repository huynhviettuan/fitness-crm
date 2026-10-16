// PT payouts (M5.7, D-027, D-032, FR-CASH-003; A-173 to A-176): pure rules shared by the API and the tests.

/**
 * Splits a contract's payout across the sessions it pays, in whole dong: each gets the same, and the dong left over go
 * one each to the first sessions. The parts add up to the total exactly, so taking one session back later (D-027) takes
 * back exactly what it was paid.
 */
export function distributeAmount(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
}

/** The kinds of line in a payout: a session paid, or a paid session taken back after it was deleted (D-027). */
export const PAYOUT_LINE_KINDS = ["SESSION", "ADJUSTMENT"] as const;
export type PayoutLineKind = (typeof PAYOUT_LINE_KINDS)[number];

/** The adjustment for a paid session that was deleted from the check-in history: minus what it was paid. */
export function adjustmentFor(paid: number): number {
  return paid === 0 ? 0 : -paid;
}
