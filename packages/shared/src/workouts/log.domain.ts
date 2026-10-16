import type { ExerciseKind } from "./catalog.domain.js";
import type { SetTargets } from "./plan.domain.js";

// The session log (M7.3, brief §7.3, FR-WKO-003; A-199 to A-205): pure rules.

/** The scales of stress, energy and sRPE (brief §7.3, A-203). */
export const LOG_SCALE = { min: 1, max: 10 } as const;

export const LOG_LIMITS = { itemsPerLog: 40, setsPerItem: 20 } as const;

/** The codes of the option entries the log finds by code (A-191); admin may rename them but should not change the codes. */
export const DEFAULT_FLAG_CODE = "NORMAL";
export const DEFAULT_ACTION_CODE = "NONE";
export const ESCALATION_ACTION_CODE = "STOP_ESCALATION";

/** What the coach writes down for one set: Strength has weight, reps and RIR; Cardio has time, speed and heart rate. */
export type SetActuals = {
  weight: number | null;
  reps: number | null;
  rir: number | null;
  durationMinutes: number | null;
  speed: number | null;
  heartRate: number | null;
};

export const STRENGTH_ACTUALS = ["weight", "reps", "rir"] as const;
export const CARDIO_ACTUALS = ["durationMinutes", "speed", "heartRate"] as const;

const ALL_ACTUALS = [...STRENGTH_ACTUALS, ...CARDIO_ACTUALS] as const;

export function actualsOf(kind: ExerciseKind): readonly (keyof SetActuals)[] {
  return kind === "CARDIO" ? CARDIO_ACTUALS : STRENGTH_ACTUALS;
}

/** The actuals filled in that the exercise's kind does not have (a weight on a Cardio exercise). */
export function foreignActuals(kind: ExerciseKind, actuals: Partial<SetActuals>): (keyof SetActuals)[] {
  const allowed = actualsOf(kind);
  return ALL_ACTUALS.filter(
    (field) => actuals[field] !== null && actuals[field] !== undefined && !allowed.includes(field),
  );
}

/** Quick entry on a phone (brief §7.3): the actual of a set starts as the plan, and the coach changes only the differences. */
export function defaultActuals(kind: ExerciseKind, planned: Partial<SetTargets>): SetActuals {
  const empty: SetActuals = {
    weight: null,
    reps: null,
    rir: null,
    durationMinutes: null,
    speed: null,
    heartRate: null,
  };
  for (const field of actualsOf(kind)) empty[field] = planned[field] ?? null;
  return empty;
}

/**
 * The planned session a new log follows (A-200): the first one in the plan's order that no log has used yet, or none
 * when every one has been used.
 */
export function nextPlannedSession<Session extends { id: string }>(
  sessions: readonly Session[],
  usedIds: ReadonlySet<string>,
): Session | null {
  return sessions.find((session) => !usedIds.has(session.id)) ?? null;
}

/** Whether a set's Action ends the session with an escalation (M7.4, brief §7.4). */
export const isEscalation = (actionCode: string | null): boolean => actionCode === ESCALATION_ACTION_CODE;
