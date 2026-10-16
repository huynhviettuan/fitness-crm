import { isRecareStatus, type LeadStatus, type ResultEffect } from "@gymcrm/shared/leads";
import { instantAt } from "@gymcrm/shared/validation";
import type { Prisma, StepTiming } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { upsertStudioTask } from "../tasks/task.service.js";
import * as repo from "./checklist.repository.js";

// The consulting checklist's engine (brief §4.1, D-020): what opens, moves, closes, and
// finishes a lead's steps. Runs inside the transaction of the change that caused it; the
// services decide who may do what.

/** What happened to a lead that may open, move, or close its steps. */
export type JourneyEvent = ({ kind: "ASSIGNED" } | { kind: "STATUS" } | { kind: "STEP_DONE"; key: string }) & {
  at: Date;
  /** Who caused it; null for the system (the round-robin). */
  by: string | null;
};

/** The lead as the triggers read it, after the change. */
export type LeadState = {
  id: string;
  leadStatus: LeadStatus | null;
  appointmentAt: Date | null;
  contactAgainOn: Date | null;
};

export type Result = { labelVi: string; labelEn: string; effect: ResultEffect | null };

export function resultsOf(template: { results: Prisma.JsonValue }): Result[] {
  const raw = Array.isArray(template.results) ? (template.results as Partial<Result>[]) : [];
  return raw.map((result) => ({
    labelVi: result.labelVi ?? "",
    labelEn: result.labelEn ?? "",
    effect: result.effect ?? null,
  }));
}

/** Gives a new lead the newest checklist, every step waiting. */
export async function startChecklist(db: Db, leadId: string): Promise<void> {
  await repo.startChecklist(db, leadId);
}

/** Applies a journey event to the lead's open and waiting steps (the triggers of checklist.schema.ts). */
export async function applyJourneyEvent(db: Db, lead: LeadState, event: JourneyEvent): Promise<void> {
  const done: string[] = [];
  for (const step of await repo.openSteps(db, lead.id)) {
    const { trigger, triggerStatus, triggerStepKey, offsetMinutes, autoComplete } = step.template;
    const after = (at: Date) => new Date(at.getTime() + offsetMinutes * 60_000);
    const open = async (dueAt: Date) => {
      if (!autoComplete) return repo.setDeadline(db, step, dueAt, event.at);
      // Opening it is doing it: done by whoever caused the event, with the first result, on time.
      await finishStep(
        db,
        step,
        { at: event.at, by: event.by, resultIndex: 0, note: null, timing: "ON_TIME", opened: true },
        event,
      );
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

type Finish = {
  at: Date;
  by: string | null;
  resultIndex: number;
  note: string | null;
  timing: StepTiming;
  opened?: boolean;
};

/** Marks a step done and runs what it does (Báo Studio). The caller applies STEP_DONE for the steps that follow. */
export async function finishStep(
  db: Db,
  step: repo.LeadStepRecord,
  finish: Finish,
  cause?: JourneyEvent,
): Promise<void> {
  await repo.completeStep(db, step.id, {
    doneAt: finish.at,
    doneById: finish.by,
    resultIndex: finish.resultIndex,
    note: finish.note,
    timing: finish.timing,
    ...(finish.opened || !step.openedAt ? { openedAt: finish.at, dueAt: step.dueAt ?? finish.at } : {}),
  });
  if (step.template.action === "STUDIO_TASK") await tellStudio(db, step, finish, cause);
}

/**
 * Records a lead's Show or No show on its open (or waiting) step whose results carry that
 * effect, so the checklist agrees with the lead (M2 slice 4). `stepId` names the step when
 * the outcome was recorded from it. Returns the step's key, for the steps that follow.
 */
export async function finishOutcomeStep(
  db: Db,
  leadId: string,
  effect: ResultEffect,
  at: Date,
  by: string,
  stepId?: string,
  note: string | null = null,
): Promise<string | null> {
  const steps = await repo.openSteps(db, leadId);
  const step = stepId
    ? steps.find((candidate) => candidate.id === stepId)
    : steps.find((candidate) => resultsOf(candidate.template).some((result) => result.effect === effect));
  if (!step) return null;
  const resultIndex = resultsOf(step.template).findIndex((result) => result.effect === effect);
  if (resultIndex < 0) return null;
  const timing = !step.dueAt || at.getTime() <= step.dueAt.getTime() ? "ON_TIME" : "LATE";
  await finishStep(db, step, { at, by, resultIndex, note, timing });
  return step.template.key;
}

/** Báo Studio: tells the studio's department about the visit through Giao việc. */
async function tellStudio(db: Db, step: repo.LeadStepRecord, finish: Finish, cause?: JourneyEvent): Promise<void> {
  const lead = await db.customer.findUniqueOrThrow({
    where: { id: step.customerId },
    select: {
      id: true,
      branchId: true,
      leadCode: true,
      fullName: true,
      appointmentAt: true,
      picUserId: true,
      assessmentType: { select: { labelVi: true } },
      assessmentTypeNote: true,
      painStatus: { select: { labelVi: true } },
      painStatusNote: true,
    },
  });
  const by = finish.by ?? lead.picUserId;
  if (!by) return;
  const when = lead.appointmentAt ? dateTime(lead.appointmentAt) : "—";
  const withNote = (label: string | undefined, note: string | null) =>
    label ? (note ? `${label}: ${note}` : label) : "—";
  // What the reminder that led here found, e.g. "Nhắc trước hẹn lần 1: Khách xác nhận".
  let reason = step.template.labelVi;
  if (cause?.kind === "STEP_DONE") {
    const previous = (await repo.leadSteps(db, lead.id)).find((candidate) => candidate.template.key === cause.key);
    const result = previous?.resultIndex != null ? resultsOf(previous.template)[previous.resultIndex] : undefined;
    if (previous && result) reason = `${step.template.labelVi} · ${previous.template.labelVi}: ${result.labelVi}`;
  }
  await upsertStudioTask(db, {
    lead,
    by,
    title: `Báo Studio: ${lead.fullName}`,
    description: [
      `Khách: ${lead.fullName} (${lead.leadCode ?? ""})`,
      `Hẹn: ${when}`,
      `Loại Assessment: ${withNote(lead.assessmentType?.labelVi, lead.assessmentTypeNote)}`,
      `Pain Status: ${withNote(lead.painStatus?.labelVi, lead.painStatusNote)}`,
    ].join("\n"),
    dueAt: lead.appointmentAt ?? finish.at,
    comment: `${reason}. Hẹn: ${when}`,
  });
}

/** dd/MM/yyyy HH:mm in the gym's time (A-001). */
function dateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.GYM_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}
