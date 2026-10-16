import { z } from "zod";
import {
  ESCALATION_ACTION_CODE,
  escalationListQuerySchema,
  escalationSeenSchema,
  type Escalation,
  type EscalationPage,
} from "@gymcrm/shared/workouts";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { notify, activeInBranch } from "../../platform/notifications/notification.service.js";
import { chosen, chosenSelect } from "../../platform/options/option.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { completeEscalationTask, createEscalationTask } from "../tasks/task.service.js";
import { logsVisibleTo } from "./log.scope.js";

// Escalation (M7.4, brief §7.4, FR-WKO-004; A-206 to A-211). A set whose Action is "Dừng + Escalation" raises one, once: the
// manager and the Master are told at once with a link to the session, a task waits in Giao việc, and one of them closes it
// by marking it seen with a direction.

const uuid = z.uuid();
const notFound = () => new AppError("NOT_FOUND");

const view = {
  log: {
    select: {
      id: true,
      branch: { select: { id: true, name: true } },
      customer: { select: { id: true, customerCode: true, fullName: true } },
      trainer: { select: { id: true, employeeCode: true, fullName: true } },
    },
  },
  flag: { select: chosenSelect },
  raisedBy: { select: { id: true, name: true } },
  seenBy: { select: { id: true, name: true } },
} satisfies Prisma.WorkoutEscalationInclude;

type Record = Prisma.WorkoutEscalationGetPayload<{ include: typeof view }>;

function toView(record: Record, actor: Actor): Escalation {
  return {
    id: record.id,
    logId: record.logId,
    status: record.seenAt ? "SEEN" : "WAITING",
    branch: record.log.branch,
    customer: {
      id: record.log.customer.id,
      customerCode: record.log.customer.customerCode ?? "",
      fullName: record.log.customer.fullName,
    },
    trainer: record.log.trainer,
    exercise: { id: record.exerciseId, name: record.exerciseName },
    setNo: record.setNo,
    flag: chosen(record.flag, record.flagNote),
    actionNote: record.actionNote,
    note: record.note,
    raisedAt: record.raisedAt,
    raisedBy: record.raisedBy,
    seenAt: record.seenAt,
    seenBy: record.seenBy,
    direction: record.direction,
    taskId: record.taskId,
    canMarkSeen: !record.seenAt && actor.permissions.has("workout.review"),
  };
}

// ------------------------------------------------------------------------------------------------------ raising

/**
 * Raises the escalation of every set of the log whose Action is "Dừng + Escalation" and has none yet (once for a set, however
 * often the log is saved). Runs in the transaction of the save, so nobody is told of a save that was rolled back. Returns
 * how many it raised.
 */
export async function raiseEscalations(tx: Db, actor: Actor, logId: string): Promise<number> {
  const sets = await tx.workoutLogSet.findMany({
    where: { item: { logId }, action: { code: ESCALATION_ACTION_CODE }, escalation: null },
    orderBy: [{ item: { position: "asc" } }, { setNo: "asc" }],
    include: {
      item: { select: { exerciseId: true, exercise: { select: { name: true } } } },
      flag: { select: { id: true, labelEn: true } },
    },
  });
  if (sets.length === 0) return 0;
  const log = await tx.workoutLog.findUniqueOrThrow({
    where: { id: logId },
    select: {
      id: true,
      branchId: true,
      customer: { select: { fullName: true } },
      trainer: { select: { fullName: true } },
    },
  });
  // The manager and the Master of the branch: whoever reviews workouts, other than the coach who raised it.
  const recipients = (
    await tx.user.findMany({
      where: {
        AND: [
          activeInBranch(log.branchId),
          { id: { not: actor.id } },
          { role: { permissions: { some: { permission: "workout.review" } } } },
        ],
      },
      select: { id: true },
      orderBy: { name: "asc" },
    })
  ).map((user) => user.id);

  for (const set of sets) {
    const exerciseName = set.item.exercise.name;
    const title = `${log.customer.fullName} · ${exerciseName}`;
    const note = set.note ?? set.flagNote ?? set.actionNote ?? "";
    const now = new Date();
    const taskId = await createEscalationTask(tx, {
      log: { id: log.id, branchId: log.branchId },
      by: actor.id,
      recipients,
      title,
      description:
        `${log.trainer.fullName} stopped the session of ${log.customer.fullName} at ${exerciseName}, set ${set.setNo}. ` +
        `Flag: ${set.flag.labelEn}.${note ? ` ${note}` : ""}`,
      dueAt: now,
    });
    const created = await tx.workoutEscalation.create({
      data: {
        logId: log.id,
        setId: set.id,
        exerciseId: set.item.exerciseId,
        exerciseName,
        setNo: set.setNo,
        flagId: set.flagId,
        flagNote: set.flagNote,
        actionNote: set.actionNote,
        note: set.note,
        raisedById: actor.id,
        raisedAt: now,
        taskId,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_escalation",
      entityId: created.id,
      action: "workout_escalation.raised",
      after: { logId: log.id, exercise: exerciseName, setNo: set.setNo, flag: set.flag.labelEn, taskId },
    });
    await notify(tx, recipients, {
      kind: "workoutEscalation",
      params: {
        customer: log.customer.fullName,
        trainer: log.trainer.fullName,
        exercise: exerciseName,
        flag: set.flag.labelEn,
        note,
      },
      link: `/workouts/logs/${log.id}`,
    });
  }
  return sets.length;
}

// ------------------------------------------------------------------------------------------------------ reading

function visibleTo(actor: Actor): Prisma.WorkoutEscalationWhereInput {
  return { log: logsVisibleTo(actor) };
}

/** The escalations an actor may see, the waiting ones first. */
export async function listEscalations(actor: Actor, rawQuery: unknown): Promise<EscalationPage> {
  assertCan(actor, "workout.view");
  const query = parseInput(escalationListQuerySchema, rawQuery);
  const where: Prisma.WorkoutEscalationWhereInput = {
    AND: [
      visibleTo(actor),
      query.status === "WAITING" ? { seenAt: null } : query.status === "SEEN" ? { seenAt: { not: null } } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.workoutEscalation.findMany({
      where,
      include: view,
      orderBy: [{ seenAt: { sort: "asc", nulls: "first" } }, { raisedAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.workoutEscalation.count({ where }),
  ]);
  return { items: items.map((item) => toView(item, actor)), total, page: query.page, pageSize: query.pageSize };
}

// ------------------------------------------------------------------------------------------------------- seeing

/**
 * The manager or the Master marks an escalation seen and writes the direction (brief §7.4): it leaves the waiting list, its
 * task is done with the direction as its last comment, and the coach is told. Marking it again changes nothing.
 */
export async function markSeen(actor: Actor, id: string, rawInput: unknown): Promise<Escalation> {
  assertCan(actor, "workout.review");
  if (!uuid.safeParse(id).success) throw notFound();
  const input = parseInput(escalationSeenSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM workout_escalations WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    const before = await tx.workoutEscalation.findFirst({ where: { AND: [{ id }, visibleTo(actor)] }, include: view });
    if (!before) throw notFound();
    if (before.seenAt) return toView(before, actor);

    const seenAt = new Date();
    const after = await tx.workoutEscalation.update({
      where: { id },
      data: { seenById: actor.id, seenAt, direction: input.direction },
      include: view,
    });
    if (before.taskId)
      await completeEscalationTask(tx, { taskId: before.taskId, by: actor.id, direction: input.direction });
    const seer = (await tx.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? "";
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_escalation",
      entityId: id,
      action: "workout_escalation.seen",
      before: { seenAt: null, direction: null },
      after: { seenAt, direction: input.direction },
    });
    await notify(tx, [before.raisedById], {
      kind: "workoutEscalationSeen",
      params: {
        by: seer,
        customer: before.log.customer.fullName,
        exercise: before.exerciseName,
        direction: input.direction,
      },
      link: `/workouts/logs/${before.logId}`,
    });
    return toView(after, actor);
  }, LOCKING_TRANSACTION);
}
