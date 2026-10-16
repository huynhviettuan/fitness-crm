import { z } from "zod";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant } from "../validation/index.js";
import { EXERCISE_KINDS } from "./catalog.domain.js";

// The progress of a customer (M7.5, brief §7.5, FR-WKO-005, AC-20; A-212 to A-217): sessions done against the plan, the
// phase and stage now, and how stress, energy, sRPE and each exercise moved over the sessions.

/** One session in the course of the customer's training. */
export const progressSessionSchema = z.object({
  logId: z.uuid(),
  sessionDate: instant,
  stress: z.int().nullable(),
  energy: z.int().nullable(),
  srpe: z.int().nullable(),
  energyAfter: z.int().nullable(),
  /** Sets with a Flag other than Normal, and escalations raised, in that session. */
  flagged: z.int(),
  escalations: z.int(),
});

/** What an exercise came to in one session: the heaviest weight and the reps of Strength, the time and speed of Cardio. */
export const progressPointSchema = z.object({
  logId: z.uuid(),
  sessionDate: instant,
  sets: z.int(),
  topWeight: z.number().nullable(),
  totalReps: z.int().nullable(),
  durationMinutes: z.number().nullable(),
  averageSpeed: z.number().nullable(),
});

export const progressExerciseSchema = z.object({
  exercise: z.object({ id: z.uuid(), name: z.string(), kind: z.enum(EXERCISE_KINDS) }),
  points: z.array(progressPointSchema),
});

/** A set that carried a Flag other than Normal or an Action other than None. */
export const progressHistorySchema = z.object({
  logId: z.uuid(),
  sessionDate: instant,
  exercise: z.string(),
  setNo: z.int(),
  flag: chosenOptionSchema,
  action: chosenOptionSchema,
  note: z.string().nullable(),
});

export const workoutProgressSchema = z
  .object({
    customerId: z.uuid(),
    /** The plan in use: its phase and goal, the sessions logged against it and planned in it, and the stage now. */
    plan: z
      .object({
        id: z.uuid(),
        name: z.string(),
        phase: z.string().nullable(),
        goal: z.string().nullable(),
        done: z.int(),
        planned: z.int(),
        currentStage: z.string().nullable(),
      })
      .nullable(),
    /** Every logged session, oldest first. */
    sessions: z.array(progressSessionSchema),
    exercises: z.array(progressExerciseSchema),
    /** The latest 100, newest first. */
    history: z.array(progressHistorySchema),
  })
  .meta({ id: "WorkoutProgress" });

export const PROGRESS_HISTORY_LIMIT = 100;

export type WorkoutProgress = z.output<typeof workoutProgressSchema>;
