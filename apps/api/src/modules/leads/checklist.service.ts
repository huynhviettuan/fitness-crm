import { z } from "zod";
import {
  checklistInputSchema,
  isRecareStatus,
  stepCompleteSchema,
  todayStepsQuerySchema,
  type Checklist,
  type LeadChecklist,
  type LeadStatus,
  type LeadStep,
  type TodaySteps,
} from "@flow/shared/leads";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { leadsVisibleTo } from "../customers/person.service.js";
import * as repo from "./checklist.repository.js";
import { lockedLead, visibleLead } from "./lead.present.js";

// The consulting checklist (brief §4.1, D-020, FR-LEAD-004/005). Each lead has the steps
// of the version it started with. A step waits until its trigger happens, then has a
// deadline; the person in charge completes it with one of its results, on time or late.
// "Việc hôm nay" lists what is due. Daily work, so no approval (OQ-029 interim).

const DAY_MS = 86_400_000;
const TODAY_LIMIT = 200;

/** What happened to a lead that may open, move, or close its steps. */
export type JourneyEvent = ({ kind: "ASSIGNED" } | { kind: "STATUS" } | { kind: "STEP_DONE"; key: string }) & {
  at: Date;
  /** Who caused it; null for the system (the round-robin). */
  by: string | null;
};

/** The lead as the triggers read it, after the change. */
type LeadState = { id: string; leadStatus: LeadStatus | null; appointmentAt: Date | null; contactAgainOn: Date | null };

export async function getChecklist(actor: Actor): Promise<Checklist> {
  assertCan(actor, "config.manage");
  const checklist = await repo.latestChecklist(prisma);
  if (!checklist) throw new AppError("NOT_FOUND");
  return presentChecklist(prisma, checklist);
}

/** Saving makes the next version; leads already started keep theirs (D-020). */
export async function saveChecklist(actor: Actor, input: unknown): Promise<Checklist> {
  assertCan(actor, "config.manage");
  const data = parseInput(checklistInputSchema, input);
  return prisma.$transaction(async (tx) => {
    await repo.lockChecklist(tx);
    const previous = await repo.latestChecklist(tx);
    const checklist = await repo.createChecklist(tx, (previous?.version ?? 0) + 1, actor.id, data);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "consulting_checklist",
      entityId: checklist.id,
      action: "consulting_checklist.created",
      before: previous ? { version: previous.version, steps: previous.steps.map(auditStep) } : null,
      after: { version: checklist.version, steps: checklist.steps.map(auditStep) },
    });
    return presentChecklist(tx, checklist);
  });
}

/** Gives a new lead the newest checklist, every step waiting. */
export async function startChecklist(db: Db, leadId: string): Promise<void> {
  await repo.startChecklist(db, leadId);
}

/**
 * Applies a journey event to the lead's open and waiting steps (the triggers of
 * packages/shared/src/leads/checklist.schema.ts). Runs in the transaction of the change.
 */
export async function applyJourneyEvent(db: Db, lead: LeadState, event: JourneyEvent): Promise<void> {
  const done: string[] = [];
  for (const step of await repo.openSteps(db, lead.id)) {
    const { trigger, triggerStatus, triggerStepKey, offsetMinutes, autoComplete } = step.template;
    const after = (at: Date) => new Date(at.getTime() + offsetMinutes * 60_000);
    const open = async (dueAt: Date) => {
      if (!autoComplete) return repo.setDeadline(db, step, dueAt, event.at);
      // Opening it is doing it: done by whoever caused the event, with the first result, on time.
      await repo.completeStep(db, step.id, {
        openedAt: event.at,
        dueAt: event.at,
        doneAt: event.at,
        doneById: event.by,
        resultIndex: 0,
        note: null,
        timing: "ON_TIME",
      });
      done.push(step.template.key);
    };
    switch (trigger) {
      case "ASSIGNED":
        // The first assignment only; a reassignment keeps the deadline.
        if (event.kind === "ASSIGNED" && !step.openedAt) await open(after(event.at));
        break;
      case "STATUS":
        // Open while the lead is in the status; a lead that leaves it first no longer needs the step.
        if (event.kind !== "STATUS") break;
        if (lead.leadStatus === triggerStatus) await open(after(event.at));
        else await repo.closeStep(db, step);
        break;
      case "APPOINTMENT":
        if (event.kind !== "STATUS") break;
        if (lead.leadStatus === "BOOKED" && lead.appointmentAt) await open(after(lead.appointmentAt));
        else await repo.closeStep(db, step);
        break;
      case "AFTER_STEP":
        if (event.kind === "STEP_DONE" && event.key === triggerStepKey) await open(after(event.at));
        break;
      case "RECARE":
        if (event.kind !== "STATUS") break;
        // Due from the start of the contact-again day (BR-204).
        if (lead.leadStatus && isRecareStatus(lead.leadStatus) && lead.contactAgainOn) {
          await open(instantAt(lead.contactAgainOn, "00:00", env.GYM_TIMEZONE));
        } else await repo.closeStep(db, step);
        break;
    }
  }
  // Steps done just now may open the ones that follow them.
  for (const key of done) await applyJourneyEvent(db, lead, { kind: "STEP_DONE", key, at: event.at, by: event.by });
}

export async function leadChecklist(actor: Actor, leadId: string, now: Date = new Date()): Promise<LeadChecklist> {
  assertCan(actor, "lead.view");
  const lead = await visibleLead(prisma, actor, leadId);
  return checklistOf(prisma, lead.id, now);
}

/**
 * The person working the lead records a step's result (FR-LEAD-004): only an open step,
 * once, with one of its own results. A step done by its deadline is on time.
 */
export async function completeLeadStep(
  actor: Actor,
  leadId: string,
  stepId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<LeadChecklist> {
  assertCan(actor, "lead.manage");
  const data = parseInput(stepCompleteSchema, input);
  return prisma.$transaction(async (tx) => {
    const lead = await lockedLead(tx, actor, leadId);
    const step = z.uuid().safeParse(stepId).success ? await repo.findLeadStep(tx, lead.id, stepId) : null;
    if (!step) throw new AppError("NOT_FOUND");
    if (step.doneAt || !step.dueAt) throw new AppError("INVALID_STATUS_TRANSITION");
    if (data.resultIndex >= resultsOf(step.template).length) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { resultIndex: ["invalidChoice"] } });
    }
    const timing = now.getTime() <= step.dueAt.getTime() ? "ON_TIME" : "LATE";
    await repo.completeStep(tx, step.id, {
      doneAt: now,
      doneById: actor.id,
      resultIndex: data.resultIndex,
      note: data.note,
      timing,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "lead",
      entityId: lead.id,
      action: "lead.step_completed",
      after: { step: step.template.key, result: resultsOf(step.template)[data.resultIndex].labelVi, timing },
      context: data.note ? { note: data.note } : undefined,
    });
    await applyJourneyEvent(tx, lead, { kind: "STEP_DONE", key: step.template.key, at: now, by: actor.id });
    return checklistOf(tx, lead.id, now);
  });
}

/** "Việc hôm nay" (FR-LEAD-005): open steps due by the end of the gym's day, overdue first. */
export async function todaySteps(actor: Actor, rawQuery: unknown, now: Date = new Date()): Promise<TodaySteps> {
  assertCan(actor, "lead.view");
  const { scope } = parseInput(todayStepsQuerySchema, rawQuery);
  const tomorrow = instantAt(
    new Date(calendarDateInTimeZone(env.GYM_TIMEZONE, now).getTime() + DAY_MS),
    "00:00",
    env.GYM_TIMEZONE,
  );
  const leads: Prisma.CustomerWhereInput = {
    AND: [leadsVisibleTo(actor), scope === "mine" ? { picUserId: actor.id } : {}],
  };
  const rows = await repo.dueSteps(prisma, leads, tomorrow, TODAY_LIMIT);
  return {
    items: rows.map((row) => ({
      step: presentStep(row, now),
      lead: {
        id: row.customer.id,
        leadCode: row.customer.leadCode ?? "",
        fullName: row.customer.fullName,
        status: row.customer.leadStatus ?? "NEW",
        pic: row.customer.pic,
      },
    })),
    overdue: rows.filter((row) => row.dueAt && row.dueAt.getTime() < now.getTime()).length,
  };
}

/** Tells the person in charge when a step comes due, once per deadline. Run by the worker (T-059). */
export async function remindDueSteps(now: Date = new Date()): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const due = await repo.claimDueSteps(tx, now);
    for (const row of due) {
      await notify(tx, [row.pic_user_id], {
        kind: "leadStepDue",
        params: { code: row.lead_code, name: row.full_name, stepVi: row.label_vi, stepEn: row.label_en },
        link: `/leads/${row.customer_id}`,
      });
    }
    return due.length;
  });
}

async function checklistOf(db: Db, leadId: string, now: Date): Promise<LeadChecklist> {
  const [version, steps] = await Promise.all([repo.leadVersion(db, leadId), repo.leadSteps(db, leadId)]);
  return { version, items: steps.map((step) => presentStep(step, now)) };
}

type Result = { labelVi: string; labelEn: string };

function resultsOf(template: { results: Prisma.JsonValue }): Result[] {
  return Array.isArray(template.results) ? (template.results as Result[]) : [];
}

function templateView(template: repo.LeadStepRecord["template"]) {
  return {
    key: template.key,
    labelVi: template.labelVi,
    labelEn: template.labelEn,
    trigger: template.trigger,
    triggerStatus: template.triggerStatus,
    triggerStepKey: template.triggerStepKey,
    offsetMinutes: template.offsetMinutes,
    required: template.required,
    autoComplete: template.autoComplete,
    results: resultsOf(template),
  };
}

function presentStep(step: repo.LeadStepRecord, now: Date): LeadStep {
  const results = resultsOf(step.template);
  return {
    ...templateView(step.template),
    id: step.id,
    state: step.doneAt ? "DONE" : step.dueAt ? "OPEN" : "WAITING",
    openedAt: step.openedAt,
    dueAt: step.dueAt,
    overdue: !step.doneAt && step.dueAt !== null && step.dueAt.getTime() < now.getTime(),
    doneAt: step.doneAt,
    doneBy: step.doneBy,
    result: step.resultIndex === null ? null : (results[step.resultIndex] ?? null),
    note: step.note,
    timing: step.timing,
  };
}

async function presentChecklist(db: Db, checklist: repo.ChecklistRecord): Promise<Checklist> {
  return {
    version: checklist.version,
    createdAt: checklist.createdAt,
    createdBy: await repo.findPerson(db, checklist.createdById),
    steps: checklist.steps.map((step) => ({ id: step.id, ...templateView(step) })),
  };
}

function auditStep(step: repo.ChecklistRecord["steps"][number]) {
  return {
    key: step.key,
    labelVi: step.labelVi,
    trigger: step.trigger,
    offsetMinutes: step.offsetMinutes,
    required: step.required,
    autoComplete: step.autoComplete,
  };
}
