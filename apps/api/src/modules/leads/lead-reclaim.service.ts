import { workingMinutesBetween } from "@gymcrm/shared/leads";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import * as repo from "./lead.repository.js";
import { assign, link, nextReceiver, params } from "./lead-journey.service.js";

// An untouched lead moves on (brief §4.1, D-052): when the person in charge has not taken care of
// a lead within `reclaimMinutes` working minutes, it goes to the next consultant by the weighted
// turn of D-050. The clock runs only inside the consultants' working window and starts when the
// lead was given. Each move is kept (who, to whom, when, and how long it waited), the previous
// person in charge is told, and the dashboard counts the moves per person.

/** Leads that could be waiting for care: consulting, in somebody's charge, not merged away. */
function waiting(db: Db) {
  return db.customer.findMany({
    where: { stage: "LEAD", mergedIntoId: null, leadStatus: "CONSULTING", picUserId: { not: null } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
}

/**
 * "Taken care of" means the person in charge did the first step of the journey, or wrote a note
 * or moved the lead after it was given (D-052). The last assignment is when the clock started.
 */
async function careState(db: Db, id: string) {
  const [assignment, steps, notes, changes] = await Promise.all([
    db.leadAssignment.findFirst({ where: { customerId: id }, orderBy: { assignedAt: "desc" } }),
    db.leadStep.findMany({
      where: { customerId: id },
      select: { doneAt: true, template: { select: { sortOrder: true } } },
    }),
    db.leadNote.count({ where: { personId: id } }),
    db.leadStatusChange.findMany({ where: { customerId: id }, select: { changedAt: true } }),
  ]);
  if (!assignment) return null;
  const first = steps.reduce<(typeof steps)[number] | null>(
    (lowest, step) => (lowest === null || step.template.sortOrder < lowest.template.sortOrder ? step : lowest),
    null,
  );
  const touchedAfter =
    changes.some((change) => change.changedAt.getTime() > assignment.assignedAt.getTime()) ||
    (notes > 0 && (await db.leadNote.count({ where: { personId: id, createdAt: { gt: assignment.assignedAt } } })) > 0);
  return { assignedAt: assignment.assignedAt, cared: first?.doneAt != null || touchedAfter };
}

/**
 * Moves every lead that has waited long enough. Run every minute by the worker (T-059). Each lead
 * is checked again under its row lock, so two processes never move it twice. Returns how many moved.
 */
export async function reclaimLeads(now: Date = new Date()): Promise<number> {
  const limit = Number(await readParameter(prisma, "reclaimMinutes"));
  if (!(limit > 0)) return 0;
  const window = {
    start: await readParameter(prisma, "consultingWindowStart"),
    end: await readParameter(prisma, "consultingWindowEnd"),
  };
  let moved = 0;
  for (const { id } of await waiting(prisma)) {
    const state = await careState(prisma, id);
    if (!state || state.cared) continue;
    if (workingMinutesBetween(state.assignedAt, now, window, env.GYM_TIMEZONE) < limit) continue;
    if (await reclaimOne(id, limit, window, now)) moved += 1;
  }
  return moved;
}

async function reclaimOne(id: string, limit: number, window: { start: string; end: string }, now: Date) {
  return prisma.$transaction(async (tx) => {
    await repo.lockLead(tx, id);
    const lead = await repo.findLead(tx, id, { stage: "LEAD", mergedIntoId: null });
    if (!lead || lead.stage !== "LEAD" || lead.leadStatus !== "CONSULTING" || !lead.picUserId) return false;
    const state = await careState(tx, id);
    if (!state || state.cared) return false;
    const waited = workingMinutesBetween(state.assignedAt, now, window, env.GYM_TIMEZONE);
    if (waited < limit) return false;
    // The next consultant by turn, not the one the lead is taken from; nobody else: it stays and keeps waiting.
    const next = await nextReceiver(tx, lead.branchId, now, lead.picUserId);
    if (!next) return false;
    const previous = lead.picUserId;
    const after = await assign(tx, null, lead, next, null, now, "RECLAIM", waited);
    await notify(tx, [previous], {
      kind: "leadReclaimed",
      params: { ...params(after), minutes: String(waited) },
      link: link(after),
    });
    return true;
  });
}
