import { z } from "zod";
import {
  DEFAULT_ACTION_CODE,
  DEFAULT_FLAG_CODE,
  defaultActuals,
  foreignActuals,
  logContentSchema,
  logCreateSchema,
  logListQuerySchema,
  nextPlannedSession,
  type Log,
  type LogPage,
  type SetActuals,
} from "@flow/shared/workouts";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import { bookingsVisibleTo } from "../bookings/booking.service.js";
import * as repo from "./log.repository.js";

// The session log (M7.3, brief §7.3, FR-WKO-003; A-199 to A-205). Opened from a PT session; the plan's targets are copied
// onto each set so plan and actual sit on one row, the actual starts as the plan, the Flag as Normal and the Action as None.
// A PT writes and sees the logs of their own sessions; managers and the Master see the branch's.

const uuid = z.uuid();
const notFound = () => new AppError("NOT_FOUND");
const invalid = (field: string, code = "invalidChoice") =>
  new AppError("VALIDATION_FAILED", { fieldErrors: { [field]: [code] } });
const decimal = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

/** The logs an actor may see: their branches', and for a PT the sessions they teach or the customers they created. */
function visibleTo(actor: Actor): Prisma.WorkoutLogWhereInput {
  const own: Prisma.WorkoutLogWhereInput = {
    OR: [...(actor.employeeId ? [{ trainerId: actor.employeeId }] : []), { customer: { createdById: actor.id } }],
  };
  return { AND: [inBranches(actor), isOwnOnly(actor, "schedule") ? own : {}] };
}

/** Whether the actor may write this log: a PT only the sessions they teach, a manager any in their branches. */
function mayWrite(actor: Actor, log: { trainerId: string }): boolean {
  if (!actor.permissions.has("workout.log")) return false;
  return !isOwnOnly(actor, "schedule") || (actor.employeeId !== null && log.trainerId === actor.employeeId);
}

function summaryOf(record: Omit<repo.LogSummaryRecord, "items">, exercises: number, sets: number) {
  return {
    id: record.id,
    bookingId: record.bookingId,
    branch: record.branch,
    customer: {
      id: record.customer.id,
      customerCode: record.customer.customerCode ?? "",
      fullName: record.customer.fullName,
    },
    trainer: record.trainer,
    sessionDate: record.booking.scheduledStart,
    plan: record.plan,
    goal: record.goal,
    exercises,
    sets,
    updatedAt: record.updatedAt,
  };
}

function toView(record: repo.LogRecord, actor: Actor): Log {
  return {
    ...summaryOf(record, record.items.length, sumSets(record.items)),
    contract: record.booking.contract,
    planSession: record.planSession,
    pre: {
      stress: { value: record.preStress, note: record.preStressNote },
      energy: { value: record.preEnergy, note: record.preEnergyNote },
      impact: record.preImpact ? chosen(record.preImpact, record.preImpactNote) : null,
    },
    post: {
      srpe: { value: record.postSrpe, note: record.postSrpeNote },
      energy: { value: record.postEnergy, note: record.postEnergyNote },
      summary: record.postSummary ? chosen(record.postSummary, record.postSummaryNote) : null,
    },
    coachNotes: record.coachNotes,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt,
    canEdit: mayWrite(actor, record),
    items: record.items.map((item) => ({
      id: item.id,
      planned: item.planItemId !== null,
      exercise: {
        id: item.exercise.id,
        name: item.exercise.name,
        kind: item.exercise.kind,
        videoUrl: item.exercise.videoUrl,
        equipmentName: item.exercise.equipment?.name ?? null,
      },
      sets: item.sets.map((set) => ({
        id: set.id,
        setNo: set.setNo,
        planned: set.planned
          ? {
              weight: decimal(set.planWeight),
              reps: set.planReps,
              restSeconds: set.planRestSeconds,
              rir: set.planRir,
              tempo: set.planTempo,
              technique: set.planTechnique,
              videoUrl: set.planVideoUrl,
              durationMinutes: decimal(set.planDurationMinutes),
              speed: decimal(set.planSpeed),
              heartRate: set.planHeartRate,
              notes: set.planNotes,
            }
          : null,
        weight: decimal(set.weight),
        reps: set.reps,
        rir: set.rir,
        durationMinutes: decimal(set.durationMinutes),
        speed: decimal(set.speed),
        heartRate: set.heartRate,
        flag: chosen(set.flag, set.flagNote),
        action: chosen(set.action, set.actionNote),
        note: set.note,
      })),
    })),
  };
}

async function viewOf(db: Db, actor: Actor, id: string): Promise<Log> {
  const record = await repo.findLog(db, { AND: [{ id }, visibleTo(actor)] });
  if (!record) throw notFound();
  return toView(record, actor);
}

// ------------------------------------------------------------------------------------------------------ reading

export async function listLogs(actor: Actor, rawQuery: unknown): Promise<LogPage> {
  assertCan(actor, "workout.view");
  const query = parseInput(logListQuerySchema, rawQuery);
  const { items, total } = await repo.listLogs(
    prisma,
    { AND: [visibleTo(actor), { customerId: query.customerId, trainerId: query.trainerId }] },
    { skip: (query.page - 1) * query.pageSize, take: query.pageSize },
  );
  return {
    items: items.map((item) =>
      summaryOf(
        item,
        item.items.length,
        item.items.reduce((sum, row) => sum + row._count.sets, 0),
      ),
    ),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getLog(actor: Actor, id: string): Promise<Log> {
  assertCan(actor, "workout.view");
  if (!uuid.safeParse(id).success) throw notFound();
  return viewOf(prisma, actor, id);
}

// ----------------------------------------------------------------------------------------------------- opening

/** The entries the log starts with: Flag Normal and Action None, found by code (A-191), else the first active entry. */
async function defaultOption(tx: Db, listKey: "workoutFlags" | "workoutActions", code: string): Promise<string> {
  const option =
    (await tx.option.findFirst({ where: { listKey, code, active: true }, select: { id: true } })) ??
    (await tx.option.findFirst({
      where: { listKey, active: true, isOther: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    }));
  if (!option) throw new AppError("VALIDATION_FAILED", { fieldErrors: { listKey: ["noDefaultOption"] } });
  return option.id;
}

/**
 * Opens the log of a PT session, or returns the one that is already open (A-199). It follows the customer's approved plan
 * for the contract: the planned session named, or the next one no log has used (A-200). Without a plan it starts empty.
 */
export async function createLog(actor: Actor, rawInput: unknown): Promise<Log> {
  assertCan(actor, "workout.log");
  const input = parseInput(logCreateSchema, rawInput);
  const open = async (): Promise<Log> =>
    prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { AND: [{ id: input.bookingId }, bookingsVisibleTo(actor)] },
        select: {
          id: true,
          branchId: true,
          customerId: true,
          contractId: true,
          trainerId: true,
          holdsSlot: true,
          consumes: true,
        },
      });
      if (!booking) throw notFound();
      if (!mayWrite(actor, booking)) throw new AppError("FORBIDDEN");
      const existing = await tx.workoutLog.findUnique({ where: { bookingId: booking.id }, select: { id: true } });
      if (existing) return viewOf(tx, actor, existing.id);
      // A cancelled session has nothing to log.
      if (!booking.holdsSlot && !booking.consumes) throw invalid("bookingId", "notLoggable");

      const plan = await tx.workoutPlan.findFirst({
        where: {
          kind: "CUSTOMER",
          status: "APPROVED",
          customerId: booking.customerId,
          contractId: booking.contractId,
        },
        orderBy: { approvedAt: "desc" },
        select: { id: true },
      });
      const sessions = plan ? await repo.plannedSessionsOf(tx, plan.id) : [];
      let planned: repo.PlannedSessionRecord | null = null;
      if (plan && input.planSessionId) {
        planned = sessions.find((session) => session.id === input.planSessionId) ?? null;
        if (!planned) throw invalid("planSessionId");
      } else if (plan) {
        planned = nextPlannedSession(sessions, await repo.usedPlanSessionIds(tx, plan.id));
      }

      const flagId = await defaultOption(tx, "workoutFlags", DEFAULT_FLAG_CODE);
      const actionId = await defaultOption(tx, "workoutActions", DEFAULT_ACTION_CODE);
      const created = await tx.workoutLog.create({
        data: {
          bookingId: booking.id,
          branchId: booking.branchId,
          customerId: booking.customerId,
          trainerId: booking.trainerId,
          planId: planned ? plan!.id : null,
          planSessionId: planned?.id ?? null,
          goal: planned?.goal ?? null,
          createdById: actor.id,
          items: {
            create: (planned?.items ?? []).map((item, itemIndex) => ({
              exerciseId: item.exercise.id,
              planItemId: item.id,
              position: itemIndex + 1,
              sets: {
                create: item.sets.map((set) => {
                  const actual: SetActuals = defaultActuals(item.exercise.kind, {
                    weight: decimal(set.weight),
                    reps: set.reps,
                    rir: set.rir,
                    durationMinutes: decimal(set.durationMinutes),
                    speed: decimal(set.speed),
                    heartRate: set.heartRate,
                  });
                  return {
                    setNo: set.setNo,
                    planned: true,
                    planWeight: set.weight,
                    planReps: set.reps,
                    planRestSeconds: set.restSeconds,
                    planRir: set.rir,
                    planTempo: set.tempo,
                    planTechnique: set.technique,
                    planVideoUrl: set.videoUrl,
                    planDurationMinutes: set.durationMinutes,
                    planSpeed: set.speed,
                    planHeartRate: set.heartRate,
                    planNotes: set.notes,
                    ...actual,
                    flagId,
                    actionId,
                  };
                }),
              },
            })),
          },
        },
        select: { id: true, planId: true, planSessionId: true, _count: { select: { items: true } } },
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "workout_log",
        entityId: created.id,
        action: "workout_log.created",
        after: {
          bookingId: booking.id,
          customerId: booking.customerId,
          trainerId: booking.trainerId,
          planId: created.planId,
          planSessionId: created.planSessionId,
          exercises: created._count.items,
        },
      });
      return viewOf(tx, actor, created.id);
    });

  try {
    return await open();
  } catch (error) {
    // Two requests opened the same session at once: the second gets the log the first made.
    if (!isUniqueViolation(error)) throw error;
    return open();
  }
}

// ------------------------------------------------------------------------------------------------------- saving

type Choices = Map<string, { id: string; active: boolean; isOther: boolean }>;

/** The entries of an option list, by id, so a log with many sets checks its choices in one query. */
async function choicesOf(tx: Db, listKey: "workoutFlags" | "workoutActions"): Promise<Choices> {
  const options = await tx.option.findMany({ where: { listKey }, select: { id: true, active: true, isOther: true } });
  return new Map(options.map((option) => [option.id, option]));
}

/** A set's Flag or Action: in the list, active or the one it already has; "Khác" comes with a note (D-016). */
function checkChoice(
  choices: Choices,
  at: string,
  field: string,
  choice: { id: string; note: string | null },
  current: string | null,
) {
  const option = choices.get(choice.id);
  if (!option || (!option.active && option.id !== current)) throw invalid(`${at}.${field}Id`);
  if (option.isOther && !choice.note) throw invalid(`${at}.${field}Note`, "otherNeedsNote");
}

const headerOf = (log: {
  goal: string | null;
  preStress: number | null;
  preEnergy: number | null;
  preImpactId: string | null;
  postSrpe: number | null;
  postEnergy: number | null;
  postSummaryId: string | null;
  coachNotes: string | null;
}) => ({
  goal: log.goal,
  preStress: log.preStress,
  preEnergy: log.preEnergy,
  preImpactId: log.preImpactId,
  postSrpe: log.postSrpe,
  postEnergy: log.postEnergy,
  postSummaryId: log.postSummaryId,
  coachNotes: log.coachNotes,
});

/**
 * Saves the log as one: the three parts and the rows (A-201, A-202). A row the plan made keeps its plan and cannot be
 * removed; the actual, the Flag, the Action and the note change; the coach may add sets and exercises of their own.
 */
export async function updateLog(actor: Actor, id: string, rawInput: unknown): Promise<Log> {
  assertCan(actor, "workout.log");
  if (!uuid.safeParse(id).success) throw notFound();
  const input = parseInput(logContentSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockLog(tx, id))) throw notFound();
    const before = await repo.findLog(tx, { AND: [{ id }, visibleTo(actor)] });
    if (!before || !mayWrite(actor, before)) throw notFound();

    const impact = input.preImpactId
      ? await resolveChoice(
          tx,
          "sessionImpacts",
          "preImpactId",
          { optionId: input.preImpactId, note: input.preImpactNote },
          before.preImpactId,
          "preImpactNote",
        )
      : null;
    const summary = input.postSummaryId
      ? await resolveChoice(
          tx,
          "sessionSummaries",
          "postSummaryId",
          { optionId: input.postSummaryId, note: input.postSummaryNote },
          before.postSummaryId,
          "postSummaryNote",
        )
      : null;

    const flags = await choicesOf(tx, "workoutFlags");
    const actions = await choicesOf(tx, "workoutActions");
    const addedIds = [...new Set(input.items.filter((item) => !item.id).map((item) => item.exerciseId))];
    const added = new Map(
      (
        await tx.workoutExercise.findMany({
          where: { id: { in: addedIds } },
          select: { id: true, kind: true, active: true },
        })
      ).map((exercise) => [exercise.id, exercise]),
    );

    const itemsBefore = new Map(before.items.map((item) => [item.id, item]));
    const keptItems = new Set<string>();
    const plan = input.items.map((item, itemIndex) => {
      const at = `items.${itemIndex}`;
      const existing = item.id ? itemsBefore.get(item.id) : undefined;
      if (item.id) {
        if (!existing || keptItems.has(item.id)) throw invalid(`${at}.id`);
        if (existing.exerciseId !== item.exerciseId) throw invalid(`${at}.exerciseId`);
        keptItems.add(item.id);
      } else {
        const exercise = added.get(item.exerciseId);
        if (!exercise?.active) throw invalid(`${at}.exerciseId`);
      }
      const kind = existing ? existing.exercise.kind : added.get(item.exerciseId)!.kind;
      const setsBefore = new Map((existing?.sets ?? []).map((set) => [set.id, set]));
      const keptSets = new Set<string>();
      for (const [setIndex, set] of item.sets.entries()) {
        const where = `${at}.sets.${setIndex}`;
        const current = set.id ? setsBefore.get(set.id) : undefined;
        if (set.id) {
          if (!current || keptSets.has(set.id)) throw invalid(`${where}.id`);
          keptSets.add(set.id);
        }
        const foreign = foreignActuals(kind, set);
        if (foreign.length > 0) throw invalid(`${where}.${foreign[0]}`, "notForThisExercise");
        checkChoice(flags, where, "flag", { id: set.flagId, note: set.flagNote }, current?.flagId ?? null);
        checkChoice(actions, where, "action", { id: set.actionId, note: set.actionNote }, current?.actionId ?? null);
      }
      for (const set of existing?.sets ?? []) {
        if (set.planned && !keptSets.has(set.id)) throw invalid(`${at}.sets`, "plannedSetRemoved");
      }
      return { item, existing, removedSets: (existing?.sets ?? []).filter((set) => !keptSets.has(set.id)) };
    });
    for (const item of before.items) {
      if (item.planItemId !== null && !keptItems.has(item.id)) throw invalid("items", "plannedExerciseRemoved");
    }

    await tx.workoutLog.update({
      where: { id },
      data: {
        goal: input.goal,
        preStress: input.preStress,
        preStressNote: input.preStressNote,
        preEnergy: input.preEnergy,
        preEnergyNote: input.preEnergyNote,
        preImpactId: impact?.optionId ?? null,
        preImpactNote: impact ? impact.note : input.preImpactNote,
        postSrpe: input.postSrpe,
        postSrpeNote: input.postSrpeNote,
        postEnergy: input.postEnergy,
        postEnergyNote: input.postEnergyNote,
        postSummaryId: summary?.optionId ?? null,
        postSummaryNote: summary ? summary.note : input.postSummaryNote,
        coachNotes: input.coachNotes,
        updatedById: actor.id,
      },
    });
    const removedItems = before.items.filter((item) => !keptItems.has(item.id)).map((item) => item.id);
    if (removedItems.length > 0) await tx.workoutLogItem.deleteMany({ where: { id: { in: removedItems } } });
    for (const [itemIndex, { item, existing, removedSets }] of plan.entries()) {
      const itemId = existing
        ? existing.id
        : (
            await tx.workoutLogItem.create({
              data: { logId: id, exerciseId: item.exerciseId, position: itemIndex + 1 },
              select: { id: true },
            })
          ).id;
      if (existing) await tx.workoutLogItem.update({ where: { id: itemId }, data: { position: itemIndex + 1 } });
      if (removedSets.length > 0) {
        await tx.workoutLogSet.deleteMany({ where: { id: { in: removedSets.map((set) => set.id) } } });
      }
      for (const [setIndex, set] of item.sets.entries()) {
        const data = {
          setNo: setIndex + 1,
          weight: set.weight,
          reps: set.reps,
          rir: set.rir,
          durationMinutes: set.durationMinutes,
          speed: set.speed,
          heartRate: set.heartRate,
          flagId: set.flagId,
          flagNote: set.flagNote,
          actionId: set.actionId,
          actionNote: set.actionNote,
          note: set.note,
        };
        if (set.id) await tx.workoutLogSet.update({ where: { id: set.id }, data });
        else await tx.workoutLogSet.create({ data: { ...data, itemId } });
      }
    }

    const after = await viewOf(tx, actor, id);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "workout_log",
      entityId: id,
      action: "workout_log.updated",
      before: { ...headerOf(before), exercises: before.items.length, sets: sumSets(before.items) },
      after: {
        ...headerOf({ ...input, preImpactId: impact?.optionId ?? null, postSummaryId: summary?.optionId ?? null }),
        exercises: after.exercises,
        sets: after.sets,
      },
    });
    return after;
  }, LOCKING_TRANSACTION);
}

const sumSets = (items: { sets: unknown[] }[]) => items.reduce((sum, item) => sum + item.sets.length, 0);
