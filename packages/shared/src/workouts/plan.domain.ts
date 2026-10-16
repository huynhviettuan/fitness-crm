import type { ExerciseKind } from "./catalog.domain.js";

// Workout plans and templates (M7.2, brief §7.1, §7.2, FR-WKO-001, FR-WKO-002, D-033; A-192 to A-198): pure rules.

export const PLAN_KINDS = ["TEMPLATE", "CUSTOMER"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/**
 * A plan is written as a draft, waits for the Master, and is then never edited: a change is a revision that replaces it
 * when approved. A rejected plan goes back to being edited.
 */
export const PLAN_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "SUPERSEDED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const canEditPlan = (status: PlanStatus): boolean => status === "DRAFT" || status === "REJECTED";
export const canSubmitPlan = canEditPlan;
export const canRevisePlan = (status: PlanStatus): boolean => status === "APPROVED";
/** Plans a session can be logged against (M7.3). */
export const isPlanInUse = (status: PlanStatus): boolean => status === "APPROVED";

export const PLAN_LIMITS = { stages: 12, sessionsPerStage: 60, itemsPerSession: 30, setsPerItem: 12 } as const;

/** The targets of one set. Strength: weight, reps, rest, RIR, tempo, technique, notes, video. Cardio: time, speed, heart rate, notes. */
export type SetTargets = {
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
};

export const STRENGTH_FIELDS = [
  "weight",
  "reps",
  "restSeconds",
  "rir",
  "tempo",
  "technique",
  "videoUrl",
  "notes",
] as const;
export const CARDIO_FIELDS = ["durationMinutes", "speed", "heartRate", "notes"] as const;

/** The fields a set of this kind of exercise may carry. */
export function fieldsOf(kind: ExerciseKind): readonly (keyof SetTargets)[] {
  return kind === "CARDIO" ? CARDIO_FIELDS : STRENGTH_FIELDS;
}

/** The fields filled in on a set that its exercise's kind does not have (a weight on a Cardio exercise, a speed on a Strength one). */
export function foreignFields(kind: ExerciseKind, set: Partial<SetTargets>): (keyof SetTargets)[] {
  const allowed = fieldsOf(kind);
  return (Object.keys(set) as (keyof SetTargets)[]).filter(
    (field) => set[field] !== null && set[field] !== undefined && !allowed.includes(field),
  );
}

export type SessionContent<Item> = { week: number | null; number: number | null; goal: string | null; items: Item[] };
export type StageContent<Item> = { stageId: string; sessions: SessionContent<Item>[] };

/**
 * A customer plan from a template (brief §7.2): each stage of the template becomes `weeks` weeks of `perWeek` sessions,
 * each a copy of the template stage's one session. The coach then adjusts it. Weeks and sessions are numbered from 1.
 */
export function expandTemplate<Item>(
  stages: readonly StageContent<Item>[],
  weeks: number,
  perWeek: number,
): StageContent<Item>[] {
  return stages.map((stage) => {
    const model = stage.sessions[0] ?? { week: null, number: null, goal: null, items: [] };
    const sessions: SessionContent<Item>[] = [];
    let week = 0;
    for (let count = 0; count < weeks; count++) {
      week += 1;
      for (let number = 1; number <= perWeek; number++) {
        sessions.push({ week, number, goal: model.goal, items: structuredClone(model.items) });
      }
    }
    return { stageId: stage.stageId, sessions };
  });
}

/**
 * Weeks are numbered through the whole plan, not per stage, so a plan of two stages of four weeks runs weeks 1 to 8:
 * the coach and the customer talk about "week 6". Renumbers the weeks of the stages one after the other.
 */
export function numberWeeksAcrossStages<Item>(stages: readonly StageContent<Item>[]): StageContent<Item>[] {
  let offset = 0;
  return stages.map((stage) => {
    const weeks = stage.sessions.map((session) => session.week ?? 0);
    const last = weeks.length === 0 ? 0 : Math.max(...weeks);
    const next = {
      stageId: stage.stageId,
      sessions: stage.sessions.map((session) => ({
        ...session,
        week: session.week === null ? null : session.week + offset,
      })),
    };
    offset += last;
    return next;
  });
}

/** How many sessions a plan has in all. */
export function plannedSessions(stages: readonly { sessions: readonly unknown[] }[]): number {
  return stages.reduce((sum, stage) => sum + stage.sessions.length, 0);
}
