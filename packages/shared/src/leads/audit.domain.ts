import type { StepTiming } from "./checklist.schema.js";
import type { LeadStatus } from "./lead.schema.js";

// The automatic consulting audit (brief §4.1, FR-LEAD-011; A-081 to A-085). Pure rules: the
// API loads the steps and fields, these decide what counts and how it scores.

/** How a due step went (A-081). */
export const STEP_OUTCOMES = ["ON_TIME", "LATE", "SKIPPED"] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

export type AuditedStep = {
  dueAt: Date | null;
  doneAt: Date | null;
  timing: StepTiming | null;
  /** Locked as "Không thực hiện" (D-054). */
  lockedAt?: Date | null;
};

/** The person has been shown or contracted: the journey went past any step still undone. */
export function journeyWentPast(status: LeadStatus | null, stage: "LEAD" | "CUSTOMER"): boolean {
  return stage === "CUSTOMER" || status === "SHOWED" || status === "CONTRACTED";
}

/**
 * How a step went, or null when it is not due: waiting for its trigger, or open with its
 * deadline still ahead (A-081).
 */
export function stepOutcome(step: AuditedStep, wentPast: boolean, now: Date): StepOutcome | null {
  if (step.doneAt) return step.timing === "LATE" ? "LATE" : "ON_TIME";
  // A step that locked was not done, whatever the lead did next (D-054).
  if (step.lockedAt) return "SKIPPED";
  if (!step.dueAt || step.dueAt.getTime() >= now.getTime()) return null;
  return wentPast ? "SKIPPED" : "LATE";
}

/** The fields the criteria look at (A-083). */
export const AUDIT_CRITERIA_KEYS = ["needGroup", "phone", "refuseReason"] as const;
export type AuditCriterionKey = (typeof AUDIT_CRITERIA_KEYS)[number];

export type AuditedFields = { needGroup: boolean; phone: boolean; refuseReason: boolean; status: LeadStatus | null };

/** Whether a criterion applies to the lead, and whether it passes (A-083). */
export function criterionResult(key: AuditCriterionKey, lead: AuditedFields): { applies: boolean; passed: boolean } {
  switch (key) {
    case "needGroup":
      return { applies: true, passed: lead.needGroup };
    case "phone":
      return { applies: true, passed: lead.phone };
    case "refuseReason":
      return { applies: lead.status === "REFUSED", passed: lead.refuseReason };
  }
}

/** What a set of checks adds up to; the score and compliance are derived (A-082). */
export type AuditTotals = {
  onTime: number;
  late: number;
  skipped: number;
  /** Weight of the checks passed and of all checks: due steps weigh 1, criteria their own weight. */
  passedWeight: number;
  totalWeight: number;
};

export const EMPTY_TOTALS: AuditTotals = { onTime: 0, late: 0, skipped: 0, passedWeight: 0, totalWeight: 0 };

export function addTotals(a: AuditTotals, b: AuditTotals): AuditTotals {
  return {
    onTime: a.onTime + b.onTime,
    late: a.late + b.late,
    skipped: a.skipped + b.skipped,
    passedWeight: a.passedWeight + b.passedWeight,
    totalWeight: a.totalWeight + b.totalWeight,
  };
}

/** Due steps. */
export const dueSteps = (totals: AuditTotals): number => totals.onTime + totals.late + totals.skipped;

/** On-time steps as a whole percentage of the due ones; null when none is due. */
export function compliancePercent(totals: AuditTotals): number | null {
  const due = dueSteps(totals);
  return due === 0 ? null : Math.round((totals.onTime / due) * 100);
}

/** The audit score as a whole percentage; null when there is nothing to check. */
export function scorePercent(totals: AuditTotals): number | null {
  return totals.totalWeight === 0 ? null : Math.round((totals.passedWeight / totals.totalWeight) * 100);
}

export type CriterionConfig = { key: AuditCriterionKey; active: boolean; weight: number };

/** The totals of one lead from the outcomes of its steps and its fields, with the failed criteria (A-082). */
export function auditLead(
  outcomes: (StepOutcome | null)[],
  fields: AuditedFields,
  criteria: CriterionConfig[],
): { totals: AuditTotals; failed: AuditCriterionKey[] } {
  const totals = { ...EMPTY_TOTALS };
  for (const outcome of outcomes) {
    if (outcome === "ON_TIME") totals.onTime++;
    else if (outcome === "LATE") totals.late++;
    else if (outcome === "SKIPPED") totals.skipped++;
  }
  totals.passedWeight = totals.onTime;
  totals.totalWeight = dueSteps(totals);
  const failed: AuditCriterionKey[] = [];
  for (const criterion of criteria) {
    if (!criterion.active) continue;
    const { applies, passed } = criterionResult(criterion.key, fields);
    if (!applies) continue;
    totals.totalWeight += criterion.weight;
    if (passed) totals.passedWeight += criterion.weight;
    else failed.push(criterion.key);
  }
  return { totals, failed };
}

/** How urgent a lead is to check: its late and skipped steps plus the weights of the criteria it fails (A-085). */
export function checkPriority(totals: AuditTotals, failedWeight: number): number {
  return totals.late + totals.skipped + failedWeight;
}
