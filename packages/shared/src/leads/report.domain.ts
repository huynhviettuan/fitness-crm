import type { StepOutcome } from "./audit.domain.js";
import type { LeadStatus } from "./lead.schema.js";

// The consulting dashboard and the lead analysis (brief §9; A-089 to A-092). Pure rules: the
// API loads each person's history, these turn it into the figures.

export type StatusChange = { toStatus: LeadStatus; changedAt: Date };

const RECARE: readonly LeadStatus[] = ["NO_RESPONSE", "REFUSED", "NO_SHOW"];

/** What one person's history says about the funnel and re-care (A-089, A-091). */
export type PersonFacts = {
  consulted: boolean;
  booked: boolean;
  showed: boolean;
  contracted: boolean;
  recareEntered: boolean;
  recareRebooked: boolean;
  /** Minutes from the first assignment to the first step done; null when either is missing (A-090). */
  firstResponseMinutes: number | null;
};

/** Entered re-care (ever No response, Refused, or No show), and booked again after the first entry (A-091). */
export function recareOutcome(changes: StatusChange[]): { entered: boolean; rebooked: boolean } {
  const first = changes
    .filter((change) => RECARE.includes(change.toStatus))
    .reduce<Date | null>((at, change) => (at === null || change.changedAt < at ? change.changedAt : at), null);
  if (first === null) return { entered: false, rebooked: false };
  return {
    entered: true,
    rebooked: changes.some((change) => change.toStatus === "BOOKED" && change.changedAt > first),
  };
}

export type FunnelTotals = {
  leads: number;
  consulted: number;
  booked: number;
  showed: number;
  contracted: number;
  recareEntered: number;
  recareRebooked: number;
  /** First-response minutes of those who have one, for the median. */
  responses: number[];
};

export const EMPTY_FUNNEL: FunnelTotals = {
  leads: 0,
  consulted: 0,
  booked: 0,
  showed: 0,
  contracted: 0,
  recareEntered: 0,
  recareRebooked: 0,
  responses: [],
};

export function addPerson(totals: FunnelTotals, facts: PersonFacts): FunnelTotals {
  return {
    leads: totals.leads + 1,
    consulted: totals.consulted + (facts.consulted ? 1 : 0),
    booked: totals.booked + (facts.booked ? 1 : 0),
    showed: totals.showed + (facts.showed ? 1 : 0),
    contracted: totals.contracted + (facts.contracted ? 1 : 0),
    recareEntered: totals.recareEntered + (facts.recareEntered ? 1 : 0),
    recareRebooked: totals.recareRebooked + (facts.recareRebooked ? 1 : 0),
    responses:
      facts.firstResponseMinutes === null ? totals.responses : [...totals.responses, facts.firstResponseMinutes],
  };
}

/** A whole percentage, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}

/** The middle value (the mean of the two middle ones for an even count), rounded; null for none. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

/** Booking rate: booked ÷ received; show rate: shown ÷ booked (A-089). */
export function funnelRates(totals: FunnelTotals) {
  return {
    bookingRate: percent(totals.booked, totals.leads),
    showRate: percent(totals.showed, totals.booked),
    recareRate: percent(totals.recareRebooked, totals.recareEntered),
    firstResponseMinutes: median(totals.responses),
  };
}

// ---------------------------------------------------------------- the steps of the checklist (D-055)

/** How the people a step was due for went on: the funnel of those who did it and of those who did not. */
export type StepCohort = { leads: number; booked: number; showed: number; contracted: number };

export const EMPTY_COHORT: StepCohort = { leads: 0, booked: 0, showed: 0, contracted: 0 };

/** One step over the cohort: whom it was due for, who did it, and what became of each group (D-055). */
export type StepTotals = {
  due: number;
  done: number;
  onTime: number;
  late: number;
  /** Locked as "Không thực hiện", or past its deadline and not done. */
  notDone: number;
  did: StepCohort;
  didNot: StepCohort;
};

export const EMPTY_STEP: StepTotals = {
  due: 0,
  done: 0,
  onTime: 0,
  late: 0,
  notDone: 0,
  did: EMPTY_COHORT,
  didNot: EMPTY_COHORT,
};

const addToCohort = (cohort: StepCohort, facts: PersonFacts): StepCohort => ({
  leads: cohort.leads + 1,
  booked: cohort.booked + (facts.booked ? 1 : 0),
  showed: cohort.showed + (facts.showed ? 1 : 0),
  contracted: cohort.contracted + (facts.contracted ? 1 : 0),
});

/**
 * Adds one person's step to its totals: its outcome (null when it is not due: waiting, or open with its
 * deadline ahead) and whether it was done. A step not due says nothing yet and is not counted (D-055).
 */
export function addStep(
  totals: StepTotals,
  outcome: StepOutcome | null,
  done: boolean,
  facts: PersonFacts,
): StepTotals {
  if (outcome === null) return totals;
  return {
    due: totals.due + 1,
    done: totals.done + (done ? 1 : 0),
    onTime: totals.onTime + (done && outcome === "ON_TIME" ? 1 : 0),
    late: totals.late + (done && outcome === "LATE" ? 1 : 0),
    notDone: totals.notDone + (done ? 0 : 1),
    did: done ? addToCohort(totals.did, facts) : totals.did,
    didNot: done ? totals.didNot : addToCohort(totals.didNot, facts),
  };
}

/** The rates of a group (D-055): booked of the group, shown of the booked, contracted of the shown. */
export function cohortRates(cohort: StepCohort): {
  leads: number;
  bookingRate: number | null;
  showRate: number | null;
  contractRate: number | null;
} {
  return {
    leads: cohort.leads,
    bookingRate: percent(cohort.booked, cohort.leads),
    showRate: percent(cohort.showed, cohort.booked),
    contractRate: percent(cohort.contracted, cohort.showed),
  };
}
