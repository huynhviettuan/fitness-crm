import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import {
  AUDIT_CRITERIA_KEYS,
  addTotals,
  auditConsultantsQuerySchema,
  auditLead,
  auditLeadsQuerySchema,
  checkPriority,
  compliancePercent,
  criteriaInputSchema,
  dueSteps,
  EMPTY_TOTALS,
  journeyWentPast,
  scorePercent,
  stepOutcome,
  type AuditCriterion,
  type AuditedStep,
  type AuditCriterionKey,
  type AuditTotals,
  type ConsultantAudit,
  type CriterionConfig,
  type LeadAudit,
  type LeadsToCheckPage,
} from "@flow/shared/leads";
import { instantAt } from "@flow/shared/validation";
import { prisma } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./lead-audit.repository.js";

// The automatic consulting audit (brief §4.1, FR-LEAD-011; A-081 to A-085): compliance and
// score per lead and per consultant, and the leads to check. Computed from the steps, never stored.

const DAY_MS = 86_400_000;

/** Everyone who came in as a lead, including the customers they became: they keep counting (A-085). */
export function auditedWhere(actor: Actor, extra: Prisma.CustomerWhereInput[] = []): Prisma.CustomerWhereInput {
  const own: Prisma.CustomerWhereInput = { OR: [{ createdById: actor.id }, { picUserId: actor.id }] };
  return {
    AND: [
      { leadCode: { not: null } },
      { mergedIntoId: null },
      inBranches(actor),
      isOwnOnly(actor, "leads") ? own : {},
      ...extra,
    ],
  };
}

/** Leads created in the period, as gym days (A-082). */
export function createdIn(query: { from?: Date; to?: Date }): Prisma.CustomerWhereInput {
  return { createdAt: gymPeriod(query) };
}

/** The instants a period of gym days covers: from the start of the first day to the end of the last. */
export function gymPeriod(query: { from?: Date; to?: Date }): { gte?: Date; lt?: Date } {
  return {
    ...(query.from ? { gte: instantAt(query.from, "00:00", env.GYM_TIMEZONE) } : {}),
    ...(query.to ? { lt: new Date(instantAt(query.to, "00:00", env.GYM_TIMEZONE).getTime() + DAY_MS) } : {}),
  };
}

const isCriterionKey = (key: string): key is AuditCriterionKey =>
  (AUDIT_CRITERIA_KEYS as readonly string[]).includes(key);

export async function criteriaFor(actor: Actor): Promise<CriterionConfig[]> {
  const rows = await repo.listCriteria(prisma);
  return (
    rows
      .flatMap(({ key, active, weight }) => (isCriterionKey(key) ? [{ key, active, weight }] : []))
      // A user who cannot see phones is not shown the phone criterion or its flags (D-017, A-084).
      .filter((criterion) => !(criterion.key === "phone" && isMasked(actor, "customer.phone")))
  );
}

/** What the audit reads of a person: the fields of the criteria and the timing of the steps. */
export type AuditSubject = Pick<
  repo.AuditedPerson,
  "leadStatus" | "stage" | "needGroupId" | "phone" | "refuseReasonId"
> & { leadSteps: AuditedStep[] };

export function auditOf(person: AuditSubject, criteria: CriterionConfig[], now: Date) {
  const wentPast = journeyWentPast(person.leadStatus, person.stage);
  const outcomes = person.leadSteps.map((step) => stepOutcome(step, wentPast, now));
  return {
    outcomes,
    ...auditLead(
      outcomes,
      {
        needGroup: person.needGroupId !== null,
        phone: person.phone !== null,
        refuseReason: person.refuseReasonId !== null,
        status: person.leadStatus,
      },
      criteria,
    ),
  };
}

const figures = (totals: AuditTotals) => ({
  onTime: totals.onTime,
  late: totals.late,
  skipped: totals.skipped,
  due: dueSteps(totals),
  compliance: compliancePercent(totals),
  score: scorePercent(totals),
});

const failedWeight = (failed: AuditCriterionKey[], criteria: CriterionConfig[]) =>
  failed.reduce((sum, key) => sum + (criteria.find((criterion) => criterion.key === key)?.weight ?? 0), 0);

/** The audit of one lead the actor may see (A-084). */
export async function leadAudit(actor: Actor, id: string, now: Date = new Date()): Promise<LeadAudit> {
  assertCan(actor, "lead.audit");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const person = await repo.findAuditedPerson(prisma, auditedWhere(actor, [{ id }]));
  if (!person) throw new AppError("NOT_FOUND");
  const criteria = await criteriaFor(actor);
  const { outcomes, totals } = auditOf(person, criteria, now);
  const steps = person.leadSteps
    .map((step, index) => ({ step, outcome: outcomes[index] }))
    .sort((a, b) => a.step.template.sortOrder - b.step.template.sortOrder);
  const fields = {
    needGroup: person.needGroupId !== null,
    phone: person.phone !== null,
    refuseReason: person.refuseReasonId !== null,
  };
  return {
    ...figures(totals),
    steps: steps.map(({ step, outcome }) => ({
      key: step.template.key,
      labelVi: step.template.labelVi,
      labelEn: step.template.labelEn,
      required: step.template.required,
      dueAt: step.dueAt,
      doneAt: step.doneAt,
      outcome,
    })),
    criteria: criteria.map(({ key, active, weight }) => {
      const applies = key !== "refuseReason" || person.leadStatus === "REFUSED";
      return { key, weight, active, applies, passed: applies ? fields[key] : null };
    }),
  };
}

type Row = {
  consultant: { id: string; name: string } | null;
  leads: number;
  totals: AuditTotals;
  toCheck: number;
  unaudited: number;
};

/** Each consultant's figures over the leads they are in charge of, and the team's (A-082, A-084). */
export async function consultantAudit(
  actor: Actor,
  rawQuery: unknown,
  now: Date = new Date(),
): Promise<ConsultantAudit> {
  assertCan(actor, "lead.audit");
  const query = parseInput(auditConsultantsQuerySchema, rawQuery);
  const [people, criteria] = await Promise.all([
    repo.auditedPeople(prisma, auditedWhere(actor, [createdIn(query)])),
    criteriaFor(actor),
  ]);
  const rows = new Map<string, Row>();
  let team = { leads: 0, totals: EMPTY_TOTALS };
  for (const person of people) {
    const { totals, failed } = auditOf(person, criteria, now);
    const key = person.picUserId ?? "none";
    const row = rows.get(key) ?? {
      consultant: person.pic,
      leads: 0,
      totals: EMPTY_TOTALS,
      toCheck: 0,
      unaudited: 0,
    };
    row.leads++;
    if (person.consultingAudits.length === 0) row.unaudited++;
    row.totals = addTotals(row.totals, totals);
    if (person.stage === "LEAD" && checkPriority(totals, failedWeight(failed, criteria)) > 0) row.toCheck++;
    rows.set(key, row);
    team = { leads: team.leads + 1, totals: addTotals(team.totals, totals) };
  }
  // Named consultants by name; leads nobody is in charge of last.
  const ordered = [...rows.values()].sort((a, b) =>
    a.consultant && b.consultant
      ? a.consultant.name.localeCompare(b.consultant.name, "vi")
      : Number(a.consultant === null) - Number(b.consultant === null),
  );
  return {
    items: ordered.map(({ consultant, leads, totals, toCheck, unaudited }) => ({
      consultant,
      leads,
      ...figures(totals),
      toCheck,
      unaudited,
    })),
    team: { leads: team.leads, ...figures(team.totals) },
  };
}

/** "Leads to check": leads still in the journey with a late or skipped step or a failed criterion, most urgent first (A-085). */
export async function leadsToCheck(actor: Actor, rawQuery: unknown, now: Date = new Date()): Promise<LeadsToCheckPage> {
  assertCan(actor, "lead.audit");
  const query = parseInput(auditLeadsQuerySchema, rawQuery);
  const [people, criteria] = await Promise.all([
    repo.auditedPeople(
      prisma,
      auditedWhere(actor, [
        { stage: "LEAD" },
        createdIn(query),
        query.consultantId ? { picUserId: query.consultantId } : {},
      ]),
    ),
    criteriaFor(actor),
  ]);
  const flagged = people
    .map((person) => {
      const { totals, failed } = auditOf(person, criteria, now);
      return { person, totals, failed, priority: checkPriority(totals, failedWeight(failed, criteria)) };
    })
    .filter((row) => row.priority > 0)
    // People come newest first; the sort is stable, so ties keep that order.
    .sort((a, b) => b.priority - a.priority);
  const start = (query.page - 1) * query.pageSize;
  return {
    items: flagged.slice(start, start + query.pageSize).map(({ person, totals, failed }) => ({
      id: person.id,
      leadCode: person.leadCode ?? "",
      fullName: person.fullName,
      status: person.leadStatus ?? "NEW",
      pic: person.pic,
      branch: person.branch,
      createdAt: person.createdAt,
      late: totals.late,
      skipped: totals.skipped,
      failed,
      score: scorePercent(totals),
    })),
    total: flagged.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

const present = (rows: { key: string; active: boolean; weight: number }[]): AuditCriterion[] =>
  rows.flatMap(({ key, active, weight }) => (isCriterionKey(key) ? [{ key, active, weight }] : []));

/** The criteria and their switches and weights (A-083). */
export async function listCriteria(actor: Actor): Promise<AuditCriterion[]> {
  assertCan(actor, "lead.audit");
  return present(await repo.listCriteria(prisma));
}

/** Admin changes the switches and weights; they apply to every score at once (A-083). */
export async function updateCriteria(actor: Actor, rawInput: unknown): Promise<AuditCriterion[]> {
  assertCan(actor, "config.manage");
  const { criteria } = parseInput(criteriaInputSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const before = new Map((await repo.listCriteria(tx)).map((row) => [row.key, row]));
    for (const input of criteria) {
      const current = before.get(input.key);
      if (!current) throw new AppError("NOT_FOUND");
      const after = await repo.updateCriterion(tx, input.key, { active: input.active, weight: input.weight });
      const changes = diffFields(current, after, ["active", "weight"]);
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "audit_criterion",
          entityId: current.id,
          action: "audit_criterion.updated",
          ...changes,
          context: { key: input.key },
        });
      }
    }
    return present(await repo.listCriteria(tx));
  });
}
