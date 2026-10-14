import {
  DEFAULT_FLAG_CODE,
  previousWeekOf,
  sharePercent,
  weekOf,
  workoutDashboardQuerySchema,
  workoutDrillQuerySchema,
  type WorkoutDashboard,
  type WorkoutDrill,
} from "@flow/shared/workouts";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../../platform/auth/session.js";
import { prisma } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { chosen, chosenSelect } from "../../platform/options/option.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { startOfGymDay } from "../bookings/booking.service.js";
import { branchesOf } from "../reports/report-scope.js";

// The weekly workout dashboard (M7.5, brief §9, FR-WKO-005, AC-21; A-212 to A-217). The figures are counted from the sets
// recorded in the logs of the sessions that fell in the week (Monday to Sunday, the gym's days).

const DAY = 86_400_000;

type Week = { from: Date; to: Date };

/** The logs of the sessions in a week, in the branches asked for. */
function logsOf(week: Week, branches: string[] | "ALL"): Prisma.WorkoutLogWhereInput {
  return {
    ...(branches === "ALL" ? {} : { branchId: { in: branches } }),
    booking: {
      scheduledStart: { gte: startOfGymDay(week.from), lt: startOfGymDay(new Date(week.to.getTime() + DAY)) },
    },
  };
}

/** A Flag other than Normal; an Action entry "Khác" has no code and counts as other. */
const notNormal: Prisma.OptionWhereInput = { OR: [{ code: null }, { code: { not: DEFAULT_FLAG_CODE } }] };

function weekAsked(rawWeek: Date | undefined): { week: Week; previous: Week } {
  const week = weekOf(rawWeek ?? calendarDateInTimeZone(env.GYM_TIMEZONE));
  return { week, previous: previousWeekOf(week) };
}

async function figures(week: Week, branches: string[] | "ALL") {
  const logs = logsOf(week, branches);
  const sets: Prisma.WorkoutLogSetWhereInput = { item: { log: logs } };
  const [flags, actions, sessions, customers, nonNormal] = await Promise.all([
    prisma.workoutLogSet.groupBy({ by: ["flagId"], where: sets, _count: { _all: true } }),
    prisma.workoutLogSet.groupBy({ by: ["actionId"], where: sets, _count: { _all: true } }),
    prisma.workoutLog.count({ where: logs }),
    prisma.workoutLog.groupBy({ by: ["customerId"], where: logs }),
    prisma.workoutLog.groupBy({
      by: ["customerId"],
      where: { AND: [logs, { items: { some: { sets: { some: { flag: notNormal } } } } }] },
    }),
  ]);
  return {
    flags: new Map(flags.map((row) => [row.flagId, row._count._all])),
    actions: new Map(actions.map((row) => [row.actionId, row._count._all])),
    sets: flags.reduce((sum, row) => sum + row._count._all, 0),
    sessions,
    customers: customers.length,
    nonNormalCustomers: nonNormal.length,
  };
}

/** The Flags or Actions shown: the active ones, and an inactive one that was used in either week. */
async function shares(
  listKey: "workoutFlags" | "workoutActions",
  now: Map<string, number>,
  before: Map<string, number>,
  totals: { now: number; before: number },
) {
  const options = await prisma.option.findMany({
    where: { listKey },
    select: { ...chosenSelect, active: true },
    orderBy: [{ isOther: "asc" }, { sortOrder: "asc" }, { labelVi: "asc" }],
  });
  return options
    .filter((option) => option.active || now.has(option.id) || before.has(option.id))
    .map((option) => {
      const sets = now.get(option.id) ?? 0;
      const previousSets = before.get(option.id) ?? 0;
      return {
        option: {
          id: option.id,
          labelVi: option.labelVi,
          labelEn: option.labelEn,
          code: option.code,
          isOther: option.isOther,
        },
        sets,
        percent: sharePercent(sets, totals.now),
        previousSets,
        previousPercent: sharePercent(previousSets, totals.before),
      };
    });
}

export async function workoutDashboard(actor: Actor, rawQuery: unknown): Promise<WorkoutDashboard> {
  assertCan(actor, "report.workouts");
  const query = parseInput(workoutDashboardQuerySchema, rawQuery);
  const branches = branchesOf(actor, query.branchId);
  const { week, previous } = weekAsked(query.week);
  const [now, before, openEscalations] = await Promise.all([
    figures(week, branches),
    figures(previous, branches),
    prisma.workoutEscalation.count({
      where: { seenAt: null, log: branches === "ALL" ? {} : { branchId: { in: branches } } },
    }),
  ]);
  const totals = { now: now.sets, before: before.sets };
  return {
    week: { from: startOfGymDay(week.from), to: startOfGymDay(week.to) },
    previousWeek: { from: startOfGymDay(previous.from), to: startOfGymDay(previous.to) },
    totals: {
      sets: now.sets,
      sessions: now.sessions,
      customers: now.customers,
      previousSets: before.sets,
      previousSessions: before.sessions,
      previousCustomers: before.customers,
    },
    flags: await shares("workoutFlags", now.flags, before.flags, totals),
    actions: await shares("workoutActions", now.actions, before.actions, totals),
    nonNormalCustomers: now.nonNormalCustomers,
    previousNonNormalCustomers: before.nonNormalCustomers,
    openEscalations,
  };
}

/** The sets behind a share: with that Flag or Action, or with any Flag other than Normal; newest session first. */
export async function workoutDrill(actor: Actor, rawQuery: unknown): Promise<WorkoutDrill> {
  assertCan(actor, "report.workouts");
  const query = parseInput(workoutDrillQuerySchema, rawQuery);
  if (query.kind !== "nonNormal" && !query.optionId) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { optionId: ["required"] } });
  }
  const branches = branchesOf(actor, query.branchId);
  const { week } = weekAsked(query.week);
  const where: Prisma.WorkoutLogSetWhereInput = {
    item: { log: logsOf(week, branches) },
    ...(query.kind === "flag"
      ? { flagId: query.optionId }
      : query.kind === "action"
        ? { actionId: query.optionId }
        : { flag: notNormal }),
  };
  const [items, total] = await Promise.all([
    prisma.workoutLogSet.findMany({
      where,
      orderBy: [
        { item: { log: { booking: { scheduledStart: "desc" } } } },
        { item: { position: "asc" } },
        { setNo: "asc" },
      ],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        flag: { select: chosenSelect },
        action: { select: chosenSelect },
        item: {
          select: {
            exercise: { select: { name: true } },
            log: {
              select: {
                id: true,
                branch: { select: { id: true, name: true } },
                customer: { select: { id: true, customerCode: true, fullName: true } },
                trainer: { select: { id: true, employeeCode: true, fullName: true } },
                booking: { select: { scheduledStart: true } },
              },
            },
          },
        },
      },
    }),
    prisma.workoutLogSet.count({ where }),
  ]);
  return {
    items: items.map((set) => ({
      logId: set.item.log.id,
      sessionDate: set.item.log.booking.scheduledStart,
      branch: set.item.log.branch,
      customer: {
        id: set.item.log.customer.id,
        customerCode: set.item.log.customer.customerCode ?? "",
        fullName: set.item.log.customer.fullName,
      },
      trainer: set.item.log.trainer,
      exercise: set.item.exercise.name,
      setNo: set.setNo,
      flag: chosen(set.flag, set.flagNote),
      action: chosen(set.action, set.actionNote),
      note: set.note,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
