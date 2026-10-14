import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";

// Workout plans and templates (M7.2, brief §7.2): one structure, a plan with stages, sessions, exercises, and sets.

const header = {
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, customerCode: true, fullName: true } },
  contract: { select: { id: true, contractCode: true } },
  trainer: { select: { id: true, employeeCode: true, fullName: true } },
  _count: { select: { stages: true } },
} satisfies Prisma.WorkoutPlanInclude;

const full = {
  ...header,
  sourceTemplate: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  revisions: { select: { id: true, status: true }, orderBy: { createdAt: "desc" } },
  stages: {
    orderBy: { position: "asc" },
    include: {
      stage: { select: { id: true, name: true } },
      sessions: {
        orderBy: { position: "asc" },
        include: {
          items: {
            orderBy: { position: "asc" },
            include: {
              exercise: {
                select: { id: true, name: true, kind: true, videoUrl: true, equipment: { select: { name: true } } },
              },
              sets: { orderBy: { setNo: "asc" } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkoutPlanInclude;

export type PlanSummaryRecord = Prisma.WorkoutPlanGetPayload<{ include: typeof header }>;
export type PlanRecord = Prisma.WorkoutPlanGetPayload<{ include: typeof full }>;

/** Locks the plan for a change, so two saves, submissions or decisions of one plan take turns. */
export async function lockPlan(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM workout_plans WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length > 0;
}

export async function listPlans(
  db: Db,
  where: Prisma.WorkoutPlanWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: (PlanSummaryRecord & { sessionCount: number })[]; total: number }> {
  const [items, total] = await Promise.all([
    db.workoutPlan.findMany({
      where,
      include: header,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.workoutPlan.count({ where }),
  ]);
  const counts = await db.workoutPlanSession.groupBy({
    by: ["stageId"],
    where: { stage: { planId: { in: items.map((item) => item.id) } } },
    _count: { _all: true },
  });
  const stages = await db.workoutPlanStage.findMany({
    where: { planId: { in: items.map((item) => item.id) } },
    select: { id: true, planId: true },
  });
  return {
    items: items.map((item) => ({
      ...item,
      sessionCount: stages
        .filter((stage) => stage.planId === item.id)
        .reduce((sum, stage) => sum + (counts.find((count) => count.stageId === stage.id)?._count._all ?? 0), 0),
    })),
    total,
  };
}

export function findPlan(db: Db, where: Prisma.WorkoutPlanWhereInput) {
  return db.workoutPlan.findFirst({ where, include: full });
}

export function createPlan(db: Db, data: Prisma.WorkoutPlanUncheckedCreateInput) {
  return db.workoutPlan.create({ data, select: { id: true } });
}

export function updatePlan(db: Db, id: string, data: Prisma.WorkoutPlanUncheckedUpdateInput) {
  return db.workoutPlan.update({ where: { id }, data, select: { id: true } });
}

export type StageData = {
  stageId: string;
  sessions: {
    week: number | null;
    number: number | null;
    goal: string | null;
    items: {
      exerciseId: string;
      sets: {
        weight: number | null;
        reps: number | null;
        restSeconds: number | null;
        rir: number | null;
        tempo: string | null;
        technique: string | null;
        videoUrl: string | null;
        durationMinutes: number | null;
        speed: number | null;
        heartRate: number | null;
        notes: string | null;
      }[];
    }[];
  }[];
};

/** Writes the stages and everything under them, in the order given. */
export async function writeStages(db: Db, planId: string, stages: StageData[]): Promise<void> {
  for (const [stageIndex, stage] of stages.entries()) {
    await db.workoutPlanStage.create({
      data: {
        planId,
        stageId: stage.stageId,
        position: stageIndex + 1,
        sessions: {
          create: stage.sessions.map((session, sessionIndex) => ({
            week: session.week,
            number: session.number,
            goal: session.goal,
            position: sessionIndex + 1,
            items: {
              create: session.items.map((item, itemIndex) => ({
                exerciseId: item.exerciseId,
                position: itemIndex + 1,
                sets: { create: item.sets.map((set, setIndex) => ({ setNo: setIndex + 1, ...set })) },
              })),
            },
          })),
        },
      },
    });
  }
}

/** Removes the stages of a draft and, by cascade, everything under them. */
export function clearStages(db: Db, planId: string) {
  return db.workoutPlanStage.deleteMany({ where: { planId } });
}

/** The ids of the exercises and stages a plan uses now, which stay allowed when it is saved again. */
export async function usedIds(db: Db, planId: string): Promise<{ exercises: Set<string>; stages: Set<string> }> {
  const [items, stages] = await Promise.all([
    db.workoutPlanItem.findMany({ where: { session: { stage: { planId } } }, select: { exerciseId: true } }),
    db.workoutPlanStage.findMany({ where: { planId }, select: { stageId: true } }),
  ]);
  return {
    exercises: new Set(items.map((item) => item.exerciseId)),
    stages: new Set(stages.map((stage) => stage.stageId)),
  };
}
