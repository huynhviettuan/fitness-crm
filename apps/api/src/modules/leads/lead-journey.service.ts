import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import {
  canChangeLeadStatus,
  isRecareStatus,
  leadAssignSchema,
  leadStatusChangeSchema,
  type Lead,
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
import { lockedLead, present, visibleLead } from "./lead.present.js";
import { applyJourneyEvent } from "./checklist.service.js";

// The lead journey (brief §3, §4.1; D-020): round-robin assignment, reassignment by
// managers, and status changes, each kept with who and when. Daily work, so no approval
// (OQ-029 interim); every change is audited (T-048).

const DAY_MS = 86_400_000;

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
  const receiver = await nextReceiver(db, lead.branchId);
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
    const from = lead.leadStatus ?? "NEW";
    if (!canChangeLeadStatus(from, change.status)) throw new AppError("INVALID_STATUS_TRANSITION");

    const appointmentAt = change.appointment
      ? instantAt(change.appointment.date, change.appointment.time, env.GYM_TIMEZONE)
      : null;
    if (appointmentAt && appointmentAt.getTime() <= now.getTime()) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { appointmentDate: ["notInFuture"] } });
    }
    const reason = change.refuseReason
      ? await resolveChoice(tx, "leadRefuseReasons", "refuseReasonId", change.refuseReason, lead.refuseReasonId)
      : { optionId: null, note: null };
    const contactAgainOn = isRecareStatus(change.status)
      ? new Date(
          calendarDateInTimeZone(env.GYM_TIMEZONE, now).getTime() +
            Number(await readParameter(tx, "recareDays")) * DAY_MS,
        )
      : null;

    const after = await repo.updateJourney(tx, id, {
      leadStatus: change.status,
      leadStatusChangedAt: now,
      appointmentAt,
      contactAgainOn,
      refuseReasonId: reason.optionId,
      refuseReasonNote: reason.note,
    });
    await repo.addStatusChange(tx, {
      customerId: id,
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
    await applyJourneyEvent(tx, after, { kind: "STATUS", at: now, by: actor.id });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "lead",
      entityId: id,
      action: "lead.status_changed",
      before: journeyOf(lead),
      after: journeyOf(after),
      context: change.note ? { note: change.note } : undefined,
    });
    return present(actor, after);
  });
}

/** Every status change and assignment of the lead, newest first (D-020). */
export async function leadTimeline(actor: Actor, id: string): Promise<LeadTimeline> {
  assertCan(actor, "lead.view");
  const lead = await visibleLead(prisma, actor, id);
  const [changes, assignments] = await repo.timeline(prisma, lead.id);
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
    })),
  ];
  return { items: items.sort((a, b) => b.at.getTime() - a.at.getTime() || rank(b) - rank(a)) };
}

/** What happens in one instant: the lead is created, then assigned, then starts Consulting. */
function rank(entry: LeadTimeline["items"][number]): number {
  if (entry.kind === "assignment") return 1;
  return entry.fromStatus === null ? 0 : 2;
}

/** The next receiver after the branch's last one, in their fixed order; the first again after the last. */
async function nextReceiver(db: Db, branchId: string): Promise<string | null> {
  await repo.lockRoundRobin(db, branchId);
  const receivers = await repo.receivers(db, branchId);
  if (receivers.length === 0) return null;
  const last = await repo.lastReceiver(db, branchId);
  const after = (user: { id: string; createdAt: Date }) =>
    last !== null &&
    (user.createdAt.getTime() > last.createdAt.getTime() ||
      (user.createdAt.getTime() === last.createdAt.getTime() && user.id > last.id));
  const next = (last && receivers.find(after)) || receivers[0];
  await repo.setLastReceiver(db, branchId, next.id);
  return next.id;
}

/** Gives the lead to `userId`; a New lead starts Consulting (brief §3). `by` is null for the round-robin. */
async function assign(
  db: Db,
  actor: Actor,
  lead: repo.LeadRecord,
  userId: string,
  by: string | null,
  now: Date,
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
    actorUserId: actor.id,
    entityType: "lead",
    entityId: lead.id,
    action: "lead.assigned",
    before: { picUserId: lead.picUserId, leadStatus: lead.leadStatus },
    after: { picUserId: userId, leadStatus: after.leadStatus },
    context: by === null ? { assignment: "roundRobin" } : undefined,
  });
  if (userId !== actor.id)
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

const params = (lead: repo.LeadRecord) => ({ code: lead.leadCode ?? "", name: lead.fullName });
const link = (lead: { id: string }) => `/leads/${lead.id}`;
