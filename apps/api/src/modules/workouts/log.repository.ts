import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { chosenSelect } from "../../platform/options/option.service.js";

// The session log (M7.3, brief §7.3): one log per PT session with its exercises and sets.

const header = {
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, customerCode: true, fullName: true } },
  trainer: { select: { id: true, employeeCode: true, fullName: true } },
  plan: { select: { id: true, name: true } },
  booking: {
    select: { scheduledStart: true, createdAt: true, contract: { select: { id: true, contractCode: true } } },
  },
  items: { select: { _count: { select: { sets: true } } } },
} satisfies Prisma.WorkoutLogInclude;

const full = {
  ...header,
  planSession: { select: { id: true, week: true, number: true } },
  preImpact: { select: chosenSelect },
  postSummary: { select: chosenSelect },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  items: {
    orderBy: { position: "asc" },
    include: {
      exercise: {
        select: { id: true, name: true, kind: true, videoUrl: true, equipment: { select: { name: true } } },
      },
      sets: {
        orderBy: { setNo: "asc" },
        include: { flag: { select: chosenSelect }, action: { select: chosenSelect } },
      },
    },
  },
} satisfies Prisma.WorkoutLogInclude;

export type LogSummaryRecord = Prisma.WorkoutLogGetPayload<{ include: typeof header }>;
export type LogRecord = Prisma.WorkoutLogGetPayload<{ include: typeof full }>;

/** Locks the log for a change, so two saves of one log take turns. */
export async function lockLog(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM workout_logs WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export async function listLogs(
  db: Db,
  where: Prisma.WorkoutLogWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: LogSummaryRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.workoutLog.findMany({
      where,
      include: header,
      orderBy: [{ booking: { scheduledStart: "desc" } }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.workoutLog.count({ where }),
  ]);
  return { items, total };
}

export function findLog(db: Db, where: Prisma.WorkoutLogWhereInput) {
  return db.workoutLog.findFirst({ where, include: full });
}

/** The planned sessions of a customer plan in the plan's order, each with its exercises and targets. */
export function plannedSessionsOf(db: Db, planId: string) {
  return db.workoutPlanSession.findMany({
    where: { stage: { planId } },
    orderBy: [{ stage: { position: "asc" } }, { position: "asc" }],
    include: {
      items: {
        orderBy: { position: "asc" },
        include: { exercise: { select: { id: true, kind: true } }, sets: { orderBy: { setNo: "asc" } } },
      },
    },
  });
}

export type PlannedSessionRecord = Awaited<ReturnType<typeof plannedSessionsOf>>[number];

/** The planned sessions that logs of the plan have already used. */
export async function usedPlanSessionIds(db: Db, planId: string): Promise<Set<string>> {
  const rows = await db.workoutLog.findMany({
    where: { planId, planSessionId: { not: null } },
    select: { planSessionId: true },
  });
  return new Set(rows.flatMap((row) => (row.planSessionId ? [row.planSessionId] : [])));
}
