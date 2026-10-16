import { z } from "zod";
import {
  DEFAULT_ACTION_CODE,
  DEFAULT_FLAG_CODE,
  PROGRESS_HISTORY_LIMIT,
  plannedSessions,
  type WorkoutProgress,
} from "@gymcrm/shared/workouts";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../../platform/auth/session.js";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { chosen, chosenSelect } from "../../platform/options/option.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import { visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import { logsVisibleTo } from "./log.scope.js";
import * as repo from "./log.repository.js";

// The progress of a customer in their profile (M7.5, brief §7.5, FR-WKO-005, AC-20; A-212 to A-217): sessions done against
// the plan in use, the phase and stage now, and how stress, energy, sRPE and each exercise moved over the sessions.

const decimal = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));
const max = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : Math.max(...present);
};
const sum = (values: (number | null)[]): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
};

export async function getProgress(actor: Actor, customerId: string): Promise<WorkoutProgress> {
  assertCan(actor, "workout.view");
  if (!z.uuid().safeParse(customerId).success) throw new AppError("NOT_FOUND");
  const customer = await prisma.customer.findFirst({
    where: { AND: [{ id: customerId }, customersVisibleTo(actor)] },
    select: { id: true },
  });
  if (!customer) throw new AppError("NOT_FOUND");

  // The plan in use: the customer's latest approved one that the actor may see (a PT: their own).
  const own = isOwnOnly(actor, "schedule");
  const plan = await repo.findPlanInUse(prisma, {
    customerId,
    ...inBranches(actor),
    ...(own ? { OR: [...(actor.employeeId ? [{ trainerId: actor.employeeId }] : []), { createdById: actor.id }] } : {}),
  });

  const logs = await prisma.workoutLog.findMany({
    where: { AND: [{ customerId }, logsVisibleTo(actor)] },
    orderBy: [{ booking: { scheduledStart: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      planId: true,
      planSessionId: true,
      preStress: true,
      preEnergy: true,
      postSrpe: true,
      postEnergy: true,
      booking: { select: { scheduledStart: true } },
      items: {
        orderBy: { position: "asc" },
        select: {
          exercise: { select: { id: true, name: true, kind: true } },
          sets: {
            orderBy: { setNo: "asc" },
            include: {
              flag: { select: chosenSelect },
              action: { select: chosenSelect },
              escalation: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  const flagged = (set: { flag: { code: string | null } }) => set.flag.code !== DEFAULT_FLAG_CODE;
  const sessions = logs.map((log) => {
    const sets = log.items.flatMap((item) => item.sets);
    return {
      logId: log.id,
      sessionDate: log.booking.scheduledStart,
      stress: log.preStress,
      energy: log.preEnergy,
      srpe: log.postSrpe,
      energyAfter: log.postEnergy,
      flagged: sets.filter(flagged).length,
      escalations: sets.filter((set) => set.escalation).length,
    };
  });

  // Each exercise over the sessions it was done in, oldest first.
  const byExercise = new Map<string, WorkoutProgress["exercises"][number]>();
  for (const log of logs) {
    for (const item of log.items) {
      if (item.sets.length === 0) continue;
      let entry = byExercise.get(item.exercise.id);
      if (!entry) {
        entry = { exercise: item.exercise, points: [] };
        byExercise.set(item.exercise.id, entry);
      }
      const durations = item.sets.map((set) => decimal(set.durationMinutes));
      const speeds = item.sets.map((set) => decimal(set.speed)).filter((value): value is number => value !== null);
      entry.points.push({
        logId: log.id,
        sessionDate: log.booking.scheduledStart,
        sets: item.sets.length,
        topWeight: max(item.sets.map((set) => decimal(set.weight))),
        totalReps: sum(item.sets.map((set) => set.reps)),
        durationMinutes: sum(durations),
        averageSpeed:
          speeds.length === 0
            ? null
            : Math.round((speeds.reduce((total, value) => total + value, 0) / speeds.length) * 10) / 10,
      });
    }
  }

  const history = logs
    .flatMap((log) =>
      log.items.flatMap((item) =>
        item.sets
          .filter((set) => flagged(set) || set.action.code !== DEFAULT_ACTION_CODE)
          .map((set) => ({
            logId: log.id,
            sessionDate: log.booking.scheduledStart,
            exercise: item.exercise.name,
            setNo: set.setNo,
            flag: chosen(set.flag, set.flagNote),
            action: chosen(set.action, set.actionNote),
            note: set.note,
          })),
      ),
    )
    .reverse()
    .slice(0, PROGRESS_HISTORY_LIMIT);

  let planView: WorkoutProgress["plan"] = null;
  if (plan) {
    const planned = plannedSessions(plan.stages);
    const used = new Set(
      logs.filter((log) => log.planId === plan.id && log.planSessionId).map((log) => log.planSessionId),
    );
    // The stage now: that of the next planned session no log has used, or the last stage once all are used.
    const next =
      plan.stages.find((stage) => stage.sessions.some((session) => !used.has(session.id))) ?? plan.stages.at(-1);
    planView = {
      id: plan.id,
      name: plan.name,
      phase: plan.phase,
      goal: plan.goal,
      done: logs.filter((log) => log.planId === plan.id).length,
      planned,
      currentStage: next?.stage.name ?? null,
    };
  }

  return { customerId, plan: planView, sessions, exercises: [...byExercise.values()], history };
}
