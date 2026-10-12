import type { Prisma } from "../../generated/prisma/client.js";
import {
  EMPTY_FUNNEL,
  EMPTY_STEP,
  EMPTY_TOTALS,
  addPerson,
  addStep,
  cohortRates,
  addTotals,
  compliancePercent,
  funnelRates,
  journeyWentPast,
  stepOutcome,
  percent,
  recareOutcome,
  reportQuerySchema,
  scorePercent,
  type AnalysisBucket,
  type AnalysisDimension,
  type AuditTotals,
  type ConsultingReport,
  type FunnelTotals,
  type LeadAnalysis,
  type PersonFacts,
  type StepTotals,
} from "@flow/shared/leads";
import { prisma } from "../../platform/db/prisma.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { auditedWhere, auditOf, createdIn, criteriaFor, gymPeriod } from "../leads/lead-audit.service.js";
import * as repo from "./report.repository.js";

// The consulting dashboard and the lead analysis (brief §9, D-041; A-089 to A-094): counts and
// rates over a cohort, never personal data. Computed from the histories, never stored.

const MINUTE = 60_000;

/** The cohort: people who came in as leads, created in the period, in the actor's scope, of a branch and person in charge (A-089). */
function cohortWhere(actor: Actor, query: { from?: Date; to?: Date; branchId?: string; staffId?: string }) {
  const extra: Prisma.CustomerWhereInput[] = [createdIn(query)];
  if (query.branchId) extra.push({ branchId: query.branchId });
  if (query.staffId) extra.push({ picUserId: query.staffId });
  return auditedWhere(actor, extra);
}

/** What the person's history says about the funnel and the first response (A-089 to A-091). */
function factsOf(person: repo.ReportPerson): PersonFacts {
  const recare = recareOutcome(person.leadStatusChanges);
  const firstStep = person.leadSteps.reduce<(typeof person.leadSteps)[number] | null>(
    (first, step) => (first === null || step.template.sortOrder < first.template.sortOrder ? step : first),
    null,
  );
  const assigned = person.leadAssignments[0]?.assignedAt ?? null;
  const firstDone = person.leadSteps.reduce<Date | null>(
    (at, step) => (step.doneAt && (at === null || step.doneAt < at) ? step.doneAt : at),
    null,
  );
  return {
    consulted: firstStep?.doneAt != null,
    booked: person.leadStatusChanges.some((change) => change.toStatus === "BOOKED"),
    showed: person.stage === "CUSTOMER" || person.leadStatusChanges.some((change) => change.toStatus === "SHOWED"),
    contracted: person.contracts.length > 0,
    recareEntered: recare.entered,
    recareRebooked: recare.rebooked,
    firstResponseMinutes:
      assigned && firstDone ? Math.max(0, Math.round((firstDone.getTime() - assigned.getTime()) / MINUTE)) : null,
  };
}

type Group = { consultant: { id: string; name: string } | null; funnel: FunnelTotals; audit: AuditTotals };

const rowOf = (funnel: FunnelTotals, audit: AuditTotals, reclaimed: number) => ({
  leads: funnel.leads,
  consulted: funnel.consulted,
  booked: funnel.booked,
  showed: funnel.showed,
  contracted: funnel.contracted,
  ...funnelRates(funnel),
  compliance: compliancePercent(audit),
  score: scorePercent(audit),
  recareEntered: funnel.recareEntered,
  recareRebooked: funnel.recareRebooked,
  reclaimed,
});

/** The consulting dashboard, per consultant and for the team (brief §9, A-089 to A-091). */
export async function consultingReport(
  actor: Actor,
  rawQuery: unknown,
  now: Date = new Date(),
): Promise<ConsultingReport> {
  assertCan(actor, "report.consulting");
  const query = parseInput(reportQuerySchema, rawQuery);
  const [people, criteria, reclaims] = await Promise.all([
    repo.reportPeople(prisma, cohortWhere(actor, query)),
    criteriaFor(actor),
    // The moves of the period, whatever the leads' age: each person's leads taken from them (D-052).
    repo.reclaimedFrom(prisma, {
      period: gymPeriod(query),
      leads: auditedWhere(actor, query.branchId ? [{ branchId: query.branchId }] : []),
      staffId: query.staffId,
    }),
  ]);
  const groups = new Map<string, Group>();
  const stepTotals = new Map<string, { labelVi: string; labelEn: string; sortOrder: number; totals: StepTotals }>();
  const reclaimed = new Map(reclaims.map(({ user, count }) => [user.id, count]));
  let team = { funnel: EMPTY_FUNNEL, audit: EMPTY_TOTALS };
  for (const person of people) {
    const facts = factsOf(person);
    const { totals } = auditOf(person, criteria, now);
    // Each step the lead has, over the cohort: whom it was due for and whether it was done (D-055).
    const wentPast = journeyWentPast(person.leadStatus, person.stage);
    for (const step of person.leadSteps) {
      const entry = stepTotals.get(step.template.key) ?? {
        labelVi: step.template.labelVi,
        labelEn: step.template.labelEn,
        sortOrder: step.template.sortOrder,
        totals: EMPTY_STEP,
      };
      entry.totals = addStep(entry.totals, stepOutcome(step, wentPast, now), step.doneAt !== null, facts);
      stepTotals.set(step.template.key, entry);
    }
    const key = person.picUserId ?? "none";
    const group = groups.get(key) ?? { consultant: person.pic, funnel: EMPTY_FUNNEL, audit: EMPTY_TOTALS };
    group.funnel = addPerson(group.funnel, facts);
    group.audit = addTotals(group.audit, totals);
    groups.set(key, group);
    team = { funnel: addPerson(team.funnel, facts), audit: addTotals(team.audit, totals) };
  }
  // A consultant who had leads moved away but received none in the period still has a row (D-052).
  for (const { user } of reclaims) {
    if (!groups.has(user.id)) groups.set(user.id, { consultant: user, funnel: EMPTY_FUNNEL, audit: EMPTY_TOTALS });
  }
  const moved = reclaims.reduce((sum, { count }) => sum + count, 0);
  // Named consultants by name; leads nobody is in charge of last.
  const ordered = [...groups.values()].sort((a, b) =>
    a.consultant && b.consultant
      ? a.consultant.name.localeCompare(b.consultant.name, "vi")
      : Number(a.consultant === null) - Number(b.consultant === null),
  );
  return {
    items: ordered.map((group) => ({
      consultant: group.consultant,
      ...rowOf(group.funnel, group.audit, group.consultant ? (reclaimed.get(group.consultant.id) ?? 0) : 0),
    })),
    team: rowOf(team.funnel, team.audit, moved),
    steps: [...stepTotals.entries()]
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([key, { labelVi, labelEn, totals }]) => ({
        key,
        labelVi,
        labelEn,
        due: totals.due,
        done: totals.done,
        onTime: totals.onTime,
        late: totals.late,
        notDone: totals.notDone,
        completionRate: percent(totals.done, totals.due),
        did: cohortRates(totals.did),
        didNot: cohortRates(totals.didNot),
      })),
  };
}

type Chosen = { id: string; labelVi: string; labelEn: string; code: string | null; isOther: boolean };

/** How a dimension reads a person: the option or the fixed value, and the note written with "Khác". */
const DIMENSIONS: Record<
  AnalysisDimension,
  (
    person: repo.ReportPerson,
  ) => { counted: false } | { counted: true; option: Chosen | null; value: string | null; note: string | null }
> = {
  channel: (p) => ({ counted: true, option: p.channel, value: null, note: p.channelNote }),
  source: (p) => ({ counted: true, option: p.source, value: null, note: p.sourceNote }),
  sourceType: (p) => ({ counted: true, option: null, value: p.sourceType, note: null }),
  needGroup: (p) => ({ counted: true, option: p.needGroup, value: null, note: p.needGroupNote }),
  nationalityGroup: (p) => ({ counted: true, option: null, value: p.nationalityGroup, note: null }),
  country: (p) => ({ counted: true, option: null, value: p.countryCode, note: null }),
  // Only people refused now, or who have a reason, have one to count (A-092).
  refuseReason: (p) =>
    p.leadStatus === "REFUSED" || p.refuseReasonId !== null
      ? { counted: true, option: p.refuseReason, value: null, note: p.refuseReasonNote }
      : { counted: false },
};

/** The lead analysis: the cohort split by channel, source, Organic or Paid, need, nationality, and refusal reason (A-092). */
export async function leadAnalysis(actor: Actor, rawQuery: unknown): Promise<LeadAnalysis> {
  assertCan(actor, "report.leadAnalysis");
  const query = parseInput(reportQuerySchema, rawQuery);
  const people = await repo.reportPeople(prisma, cohortWhere(actor, query));
  const facts = people.map((person) => ({ person, facts: factsOf(person) }));

  const dimensions = (Object.keys(DIMENSIONS) as AnalysisDimension[]).map((dimension) => {
    const buckets = new Map<
      string,
      {
        option: Chosen | null;
        value: string | null;
        totals: FunnelTotals;
        notes: Map<string, Map<string, number>>;
      }
    >();
    for (const { person, facts: personFacts } of facts) {
      const read = DIMENSIONS[dimension](person);
      if (!read.counted) continue;
      const key = read.option?.id ?? read.value ?? "none";
      const bucket = buckets.get(key) ?? {
        option: read.option,
        value: read.value,
        totals: EMPTY_FUNNEL,
        notes: new Map(),
      };
      bucket.totals = addPerson(bucket.totals, personFacts);
      const note = read.note?.trim();
      if (read.option?.isOther && note) {
        // Notes that differ only in case are one note; each spelling is counted.
        const spellings = bucket.notes.get(note.toLowerCase()) ?? new Map<string, number>();
        spellings.set(note, (spellings.get(note) ?? 0) + 1);
        bucket.notes.set(note.toLowerCase(), spellings);
      }
      buckets.set(key, bucket);
    }
    const list: AnalysisBucket[] = [...buckets.values()]
      .map(({ option, value, totals, notes }) => ({
        option: option && {
          id: option.id,
          labelVi: option.labelVi,
          labelEn: option.labelEn,
          code: option.code,
          isOther: option.isOther,
        },
        value,
        leads: totals.leads,
        booked: totals.booked,
        showed: totals.showed,
        contracted: totals.contracted,
        bookingRate: percent(totals.booked, totals.leads),
        showRate: percent(totals.showed, totals.booked),
        notes: [...notes.values()]
          .map((spellings) => {
            // Shown as its most used spelling, the first alphabetically on a tie.
            const [text] = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"))[0];
            return { note: text, count: [...spellings.values()].reduce((sum, n) => sum + n, 0) };
          })
          .sort((a, b) => b.count - a.count || a.note.localeCompare(b.note, "vi"))
          .slice(0, 20),
      }))
      // Most leads first; the bucket "not given" last.
      .sort(
        (a, b) =>
          Number(a.option === null && a.value === null) - Number(b.option === null && b.value === null) ||
          b.leads - a.leads,
      );
    return { dimension, buckets: list };
  });
  return { total: people.length, dimensions };
}
