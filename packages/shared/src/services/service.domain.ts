/** Services and price tiers (D-021, brief §5.1, BR-301): the lookup of a session count and the end date. Pure rules. */

export const SERVICE_KINDS = ["PT", "CLASS", "MEMBER"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export type PriceTierRow = {
  minSessions: number;
  /** null: no upper limit. */
  maxSessions: number | null;
  /** Whole đồng per session. */
  unitPrice: number;
  validityMonths: number;
  validityDays: number;
};

/** The tier that covers `sessions`, or null when it falls in a gap or outside every tier. */
export function findTier<T extends PriceTierRow>(tiers: readonly T[], sessions: number): T | null {
  return (
    tiers.find((tier) => sessions >= tier.minSessions && (tier.maxSessions === null || sessions <= tier.maxSessions)) ??
    null
  );
}

/** What is wrong with a set of tiers, as `validation.*` keys; empty when it is usable. Gaps are allowed (BR-301). */
export function tiersProblems(
  tiers: readonly PriceTierRow[],
): ("tierRangeInverted" | "tiersOverlap" | "openTierNotLast")[] {
  const problems = new Set<"tierRangeInverted" | "tiersOverlap" | "openTierNotLast">();
  const sorted = [...tiers].sort((a, b) => a.minSessions - b.minSessions);
  for (const [index, tier] of sorted.entries()) {
    if (tier.maxSessions !== null && tier.maxSessions < tier.minSessions) problems.add("tierRangeInverted");
    const next = sorted[index + 1];
    if (!next) continue;
    if (tier.maxSessions === null) problems.add("openTierNotLast");
    else if (next.minSessions <= tier.maxSessions) problems.add("tiersOverlap");
  }
  return [...problems];
}

const DAY_MS = 86_400_000;

/**
 * The last day of a contract: the start day counts as the first day, so it is the start plus the months and days, less
 * one day (A-108). Months keep the day of the month and stop at the end of a shorter month. `start` is a calendar day as
 * UTC midnight.
 */
export function endDateOf(start: Date, months: number, days: number): Date {
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), month + 1, 0)).getUTCDate();
  const base = Date.UTC(start.getUTCFullYear(), month, Math.min(start.getUTCDate(), lastDay));
  return new Date(base + (days - 1) * DAY_MS);
}

/** The name a contract shows: the service and the real session count, so they always agree (D-021). */
export function displayNameOf(serviceName: string, sessions: number): string {
  return `${serviceName} ${sessions} buổi`;
}

/** The version of a service's tiers in force on `day`: the latest one that has started. */
export function versionInForce<V extends { effectiveFrom: Date }>(versions: readonly V[], day: Date): V | null {
  let found: V | null = null;
  for (const version of versions) {
    if (version.effectiveFrom.getTime() > day.getTime()) continue;
    if (!found || version.effectiveFrom.getTime() > found.effectiveFrom.getTime()) found = version;
  }
  return found;
}
