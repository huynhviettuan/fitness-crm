import { z } from "zod";
import {
  checklistInputSchema,
  leadStatusChangeSchema,
  stepCompleteSchema,
  todayStepsQuerySchema,
  type Checklist,
  type LeadChecklist,
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
import { applyJourneyEvent, finishOutcomeStep, finishStep, resultsOf } from "./checklist.engine.js";
import { convertLead, recordNoShow } from "./lead-outcome.service.js";
import { moveLead } from "./lead-journey.service.js";

// The consulting checklist (brief §4.1, D-020, FR-LEAD-004/005). Each lead has the steps
// of the version it started with. A step waits until its trigger happens, then has a
// deadline; the person in charge completes it with one of its results, on time or late.
// "Việc hôm nay" lists what is due. Daily work, so no approval (OQ-029 interim). The
// triggers themselves are in checklist.engine.ts.

const DAY_MS = 86_400_000;
const TODAY_LIMIT = 200;

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

export async function leadChecklist(actor: Actor, leadId: string, now: Date = new Date()): Promise<LeadChecklist> {
  assertCan(actor, "lead.view");
  const lead = await visibleLead(prisma, actor, leadId);
  return checklistOf(prisma, lead.id, now);
}

/**
 * The person working the lead records a step's result (FR-LEAD-004): only an open step,
 * once, with one of its own results. A step done by its deadline is on time. A result
 * that converts the lead (Show) needs the Show details; Show and No show do what the
 * lead's own buttons do (lead-outcome.service.ts).
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
    const result = resultsOf(step.template)[data.resultIndex];
    if (!result) throw new AppError("VALIDATION_FAILED", { fieldErrors: { resultIndex: ["invalidChoice"] } });
    if (result.effect === "SHOW") {
      if (!data.show) throw new AppError("VALIDATION_FAILED", { fieldErrors: { show: ["required"] } });
      await convertLead(tx, actor, lead, data.show, now, { stepId: step.id, note: data.note });
      return checklistOf(tx, lead.id, now);
    }
    if (result.effect === "NO_SHOW") {
      await recordNoShow(tx, actor, lead, now, { stepId: step.id, note: data.note });
      return checklistOf(tx, lead.id, now);
    }
    if (result.effect === "BOOK" || result.effect === "REFUSE") {
      await followStatusResult(tx, actor, lead, step, result.effect, data, now);
      return checklistOf(tx, lead.id, now);
    }
    const timing = now.getTime() <= step.dueAt.getTime() ? "ON_TIME" : "LATE";
    await finishStep(tx, step, { at: now, by: actor.id, resultIndex: data.resultIndex, note: data.note, timing });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "lead",
      entityId: lead.id,
      action: "lead.step_completed",
      after: { step: step.template.key, result: result.labelVi, timing },
      context: data.note ? { note: data.note } : undefined,
    });
    await applyJourneyEvent(tx, lead, { kind: "STEP_DONE", key: step.template.key, at: now, by: actor.id });
    return checklistOf(tx, lead.id, now);
  });
}

/**
 * Re-care results (brief §4.1 step 10): Đặt lịch books the lead again, Từ chối refuses it
 * with the next contact-again day; both are the status change of the lead's own buttons
 * (A-062). The step is finished first, because the new status would close it.
 */
async function followStatusResult(
  tx: Db,
  actor: Actor,
  lead: Awaited<ReturnType<typeof lockedLead>>,
  step: NonNullable<Awaited<ReturnType<typeof repo.findLeadStep>>>,
  effect: "BOOK" | "REFUSE",
  data: z.output<typeof stepCompleteSchema>,
  now: Date,
): Promise<void> {
  if (effect === "BOOK" ? !data.book : !data.refuse) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { [effect === "BOOK" ? "book" : "refuse"]: ["required"] } });
  }
  const note = data.note ?? "";
  const input =
    effect === "BOOK"
      ? { status: "BOOKED", ...data.book, note }
      : { status: "REFUSED", ...data.refuse, refuseReasonNote: data.refuse?.refuseReasonNote ?? "", note };
  const underStep = (error: unknown) => {
    if (!(error instanceof AppError) || !error.fieldErrors) return error;
    const prefix = effect === "BOOK" ? "book" : "refuse";
    return new AppError(error.code, {
      fieldErrors: Object.fromEntries(
        Object.entries(error.fieldErrors).map(([field, messages]) => [
          field === "note" ? field : `${prefix}.${field}`,
          messages,
        ]),
      ),
    });
  };
  let change;
  try {
    change = parseInput(leadStatusChangeSchema, input);
  } catch (error) {
    throw underStep(error);
  }
  const key = await finishOutcomeStep(tx, lead.id, effect, now, actor.id, step.id, data.note);
  let after;
  try {
    after = await moveLead(tx, actor, lead, change, now, effect === "REFUSE");
  } catch (error) {
    throw underStep(error);
  }
  if (key) await applyJourneyEvent(tx, after, { kind: "STEP_DONE", key, at: now, by: actor.id });
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
    action: template.action,
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
    action: step.action,
  };
}
