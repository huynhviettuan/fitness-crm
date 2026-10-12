import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import { isWithinAccessWindows } from "../../platform/auth/access-hours.js";
import {
  takeTurn,
  type AssignmentKind,
  canChangeLeadStatus,
  isRecareStatus,
  nextContactAgainOn,
  leadAssignSchema,
  leadStatusChangeSchema,
  type Lead,
  type LeadStatusChange,
  type LeadTimeline,
} from "@flow/shared/leads";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { notify } from "../../platform/notifications/notification.service.js";
import * as repo from "./lead.repository.js";
import { lockedLead, present, visibleLead, visiblePerson } from "./lead.present.js";
import { applyJourneyEvent } from "./checklist.engine.js";
import { intakeEntries } from "./intake-history.js";
import { noteView } from "./lead-note.service.js";

// The lead journey (brief §3, §4.1; D-020): round-robin assignment, reassignment by
// managers, and status changes, each kept with who and when. Daily work, so no approval
// (OQ-029 interim); every change is audited (T-048).

/**
 * Runs inside the creating transaction (BR-203): records the creation, hands the lead
 * round-robin to the next person of its branch who receives leads, and tells the
 * branch's lead managers. Without anyone to receive it the lead stays New.
 */
export async function startJourney(db: Db, actor: Actor, lead: repo.LeadRecord, now: Date): Promise<repo.LeadRecord> {
  await repo.addStatusChange(db, {
    customerId: lead.id,
    fromStatus: null,
    toStatus: "NEW",
    changedById: actor.id,
    changedAt: now,
  });
  const receiver = await nextReceiver(db, lead.branchId, now);
  const assigned = receiver ? await assign(db, actor, lead, receiver, null, now) : lead;
  const managers = (await repo.leadManagers(db, lead.branchId)).filter((id) => id !== actor.id);
  await notify(db, managers, { kind: "leadNew", params: params(assigned), link: link(lead) });
  return assigned;
}

/** Managers hand a lead to someone else who receives leads (BR-203). Giving it to its PIC changes nothing. */
export async function assignLead(actor: Actor, id: string, input: unknown): Promise<Lead> {
  assertCan(actor, "lead.assign");
  const { userId } = parseInput(leadAssignSchema, input);
  return prisma.$transaction(async (tx) => {
    const lead = await lockedLead(tx, actor, id);
    if (!(await repo.receivers(tx, lead.branchId)).some((user) => user.id === userId)) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { userId: ["invalidChoice"] } });
    }
    if (lead.picUserId === userId) return present(actor, lead);
    return present(actor, await assign(tx, actor, lead, userId, actor.id, new Date()));
  });
}

/** Who the lead may be given to: active users of its branch who receive leads. */
export async function leadAssignees(actor: Actor, id: string): Promise<{ items: { id: string; name: string }[] }> {
  assertCan(actor, "lead.assign");
  const lead = await visibleLead(prisma, actor, id);
  const users = await repo.receivers(prisma, lead.branchId);
  return {
    items: users
      .map(({ id: userId, name }) => ({ id: userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi")),
  };
}

/**
 * Moves a lead along the fixed flow (D-020, lead.domain.ts). Booked needs a future
 * appointment; Refused a reason (BR-204); No response, Refused, and No show get the day
 * to contact them again, `recareDays` after today. A repeated request finds the lead
 * already moved and is refused, so nothing is recorded twice.
 */
export async function changeLeadStatus(
  actor: Actor,
  id: string,
  input: unknown,
  now: Date = new Date(),
): Promise<Lead> {
  assertCan(actor, "lead.manage");
  const change = parseInput(leadStatusChangeSchema, input);
  return prisma.$transaction(async (tx) => {
    const lead = await lockedLead(tx, actor, id);
    return present(actor, await moveLead(tx, actor, lead, change, now));
  });
}

/**
 * The status change itself, for a locked, visible lead inside the caller's transaction:
 * the lead's own buttons and the re-care step's results (Đặt lịch, Từ chối) both end here.
 * `again` lets a Refused lead be refused again with a new day and reason (A-062).
 */
export async function moveLead(
  db: Db,
  actor: Actor,
  lead: repo.LeadRecord,
  change: LeadStatusChange,
  now: Date,
  again = false,
): Promise<repo.LeadRecord> {
  const from = lead.leadStatus ?? "NEW";
  if (!(again && from === change.status) && !canChangeLeadStatus(from, change.status)) {
    throw new AppError("INVALID_STATUS_TRANSITION");
  }
  const appointmentAt = change.appointment
    ? instantAt(change.appointment.date, change.appointment.time, env.GYM_TIMEZONE)
    : null;
  if (appointmentAt && appointmentAt.getTime() <= now.getTime()) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { appointmentDate: ["notInFuture"] } });
  }
  const reason = change.refuseReason
    ? await resolveChoice(db, "leadRefuseReasons", "refuseReasonId", change.refuseReason, lead.refuseReasonId)
    : { optionId: null, note: null };
  const recare = isRecareStatus(change.status);
  const contactAgainOn = recare ? await contactAgainDay(db, now) : null;

  const after = await repo.updateJourney(db, lead.id, {
    leadStatus: change.status,
    leadStatusChangedAt: now,
    appointmentAt,
    contactAgainOn,
    refuseReasonId: reason.optionId,
    refuseReasonNote: reason.note,
  });
  await repo.addStatusChange(db, {
    customerId: lead.id,
    fromStatus: from,
    toStatus: change.status,
    changedById: actor.id,
    changedAt: now,
    appointmentAt,
    reasonId: reason.optionId,
    reasonNote: reason.note,
    note: change.note,
  });
  // The consulting steps that wait for this status, the appointment, or re-care (D-020).
  await applyJourneyEvent(db, after, { kind: "STATUS", at: now, by: actor.id });
  await recordAudit(db, {
    actorUserId: actor.id,
    entityType: "lead",
    entityId: lead.id,
    action: "lead.status_changed",
    before: journeyOf(lead),
    after: journeyOf(after),
    context: change.note ? { note: change.note } : undefined,
  });
  if (recare) await notifyRecare(db, actor, after);
  return after;
}

/**
 * A lead entering re-care goes back to its consultant's list; the consultant and the
 * branch's managers are told, except whoever did it (BR-203, BR-204).
 */
export async function notifyRecare(db: Db, actor: Actor, lead: repo.LeadRecord): Promise<void> {
  const managers = await repo.leadManagers(db, lead.branchId);
  await notify(
    db,
    [lead.picUserId, ...managers].filter((id) => id !== actor.id),
    { kind: "leadRecare", params: params(lead), link: link(lead) },
  );
}

/** The day a lead in re-care is due to be contacted again: `recareDays` after the gym's today (BR-204). */
export async function contactAgainDay(db: Db, now: Date): Promise<Date> {
  const days = Number(await readParameter(db, "recareDays"));
  return nextContactAgainOn(calendarDateInTimeZone(env.GYM_TIMEZONE, now), days);
}

/** Every status change, assignment, note, inquiry, and merge of the lead, newest first (D-020). */
export async function leadTimeline(actor: Actor, id: string): Promise<LeadTimeline> {
  assertCan(actor, "lead.view");
  // Also the customer a lead became (the Consulting history tab, A-076).
  const lead = await visiblePerson(prisma, actor, id);
  const [changes, assignments] = await repo.timeline(prisma, lead.id);
  const intake = await intakeEntries(prisma, lead.id);
  const notes = (await repo.notesOf(prisma, lead.id)).map(noteView);
  const items: LeadTimeline["items"] = [
    ...changes.map((change) => ({
      kind: "status" as const,
      id: change.id,
      at: change.changedAt,
      by: change.changedBy,
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      appointmentAt: change.appointmentAt,
      refuseReason: change.reason ? chosen(change.reason, change.reasonNote) : null,
      note: change.note,
    })),
    ...assignments.map((assignment) => ({
      kind: "assignment" as const,
      id: assignment.id,
      at: assignment.assignedAt,
      by: assignment.assignedBy,
      from: assignment.fromUser,
      to: assignment.toUser,
      how: assignment.kind,
      waitedMinutes: assignment.waitedMinutes,
    })),
    ...notes,
    ...intake,
  ];
  return { items: items.sort((a, b) => b.at.getTime() - a.at.getTime() || rank(b) - rank(a)) };
}

/** What happens in one instant: the lead is created, then assigned, then starts Consulting. */
function rank(entry: LeadTimeline["items"][number]): number {
  if (entry.kind === "assignment") return 1;
  if (entry.kind !== "status") return 3;
  return entry.fromStatus === null ? 0 : 2;
}

/**
 * The consultant who takes the branch's next lead (D-050): a weighted round-robin among those
 * whose receiving switch is on and who are within their working hours (their access windows),
 * in their fixed order. When nobody is within hours the lead still goes to the next one in turn,
 * so it is not left unassigned overnight. `except` leaves out the consultant a lead is taken from
 * (D-052). Without anyone, null: the lead stays New and the managers assign it by hand.
 */
export async function nextReceiver(
  db: Db,
  branchId: string,
  now: Date = new Date(),
  except: string | null = null,
): Promise<string | null> {
  await repo.lockRoundRobin(db, branchId);
  const takers = (await repo.turnTakers(db, branchId)).filter((user) => user.id !== except);
  const onDuty = takers.filter((user) => isWithinAccessWindows(user.accessWindows, now, env.GYM_TIMEZONE));
  const pool = onDuty.length > 0 ? onDuty : takers;
  if (pool.length === 0) return null;
  const { vtimes, latest } = await repo.turnState(
    db,
    branchId,
    pool.map((user) => user.id),
  );
  const turn = takeTurn(
    pool.map((user) => ({ id: user.id, weight: user.leadWeight, vtime: vtimes.get(user.id) ?? latest })),
    latest,
  );
  if (!turn) return null;
  await repo.saveTurnTimes(db, branchId, turn.vtimes);
  return turn.chosen;
}

/** Gives the lead to `userId`; a New lead starts Consulting (brief §3). `by` is null for the round-robin. */
export async function assign(
  db: Db,
  actor: Pick<Actor, "id"> | null,
  lead: repo.LeadRecord,
  userId: string,
  by: string | null,
  now: Date,
  how: AssignmentKind = by === null ? "ROUND_ROBIN" : "MANUAL",
  waitedMinutes: number | null = null,
): Promise<repo.LeadRecord> {
  const starts = lead.leadStatus === "NEW";
  const after = await repo.updateJourney(db, lead.id, {
    picUserId: userId,
    ...(starts ? { leadStatus: "CONSULTING", leadStatusChangedAt: now } : {}),
  });
  await repo.addAssignment(db, {
    customerId: lead.id,
    fromUserId: lead.picUserId,
    toUserId: userId,
    assignedById: by,
    assignedAt: now,
    kind: how,
    waitedMinutes,
  });
  if (starts) {
    await repo.addStatusChange(db, {
      customerId: lead.id,
      fromStatus: "NEW",
      toStatus: "CONSULTING",
      changedById: by,
      changedAt: now,
    });
  }
  await applyJourneyEvent(db, after, { kind: "ASSIGNED", at: now, by });
  if (starts) await applyJourneyEvent(db, after, { kind: "STATUS", at: now, by });
  await recordAudit(db, {
    actorUserId: actor?.id ?? null,
    entityType: "lead",
    entityId: lead.id,
    action: "lead.assigned",
    before: { picUserId: lead.picUserId, leadStatus: lead.leadStatus },
    after: { picUserId: userId, leadStatus: after.leadStatus },
    context:
      how === "RECLAIM"
        ? { assignment: "reclaim", waitedMinutes }
        : by === null
          ? { assignment: "roundRobin" }
          : undefined,
  });
  if (userId !== actor?.id)
    await notify(db, [userId], { kind: "leadAssigned", params: params(after), link: link(after) });
  return after;
}

function journeyOf(lead: repo.LeadRecord) {
  return {
    leadStatus: lead.leadStatus,
    appointmentAt: lead.appointmentAt,
    contactAgainOn: lead.contactAgainOn,
    refuseReasonId: lead.refuseReasonId,
    refuseReasonNote: lead.refuseReasonNote,
  };
}

export const params = (lead: repo.LeadRecord) => ({ code: lead.leadCode ?? "", name: lead.fullName });
export const link = (lead: { id: string }) => `/leads/${lead.id}`;
