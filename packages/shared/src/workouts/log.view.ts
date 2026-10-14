import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { EXERCISE_KINDS } from "./catalog.domain.js";

// The session log (M7.3, brief §7.3): responses.

/** The plan's targets of a set as they were when the log was made. */
export const logPlannedSchema = z.object({
  weight: z.number().nullable(),
  reps: z.int().nullable(),
  restSeconds: z.int().nullable(),
  rir: z.int().nullable(),
  tempo: z.string().nullable(),
  technique: z.string().nullable(),
  videoUrl: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  speed: z.number().nullable(),
  heartRate: z.int().nullable(),
  notes: z.string().nullable(),
});

export const logSetSchema = z.object({
  id: z.uuid(),
  setNo: z.int(),
  /** The plan's row, or none for a set the coach added. */
  planned: logPlannedSchema.nullable(),
  weight: z.number().nullable(),
  reps: z.int().nullable(),
  rir: z.int().nullable(),
  durationMinutes: z.number().nullable(),
  speed: z.number().nullable(),
  heartRate: z.int().nullable(),
  flag: chosenOptionSchema,
  action: chosenOptionSchema,
  note: z.string().nullable(),
});

export const logItemSchema = z.object({
  id: z.uuid(),
  /** Whether the plan had this exercise (its sets cannot be removed) or the coach added it. */
  planned: z.boolean(),
  exercise: z.object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(EXERCISE_KINDS),
    videoUrl: z.string().nullable(),
    equipmentName: z.string().nullable(),
  }),
  sets: z.array(logSetSchema),
});

const scaleWithNote = z.object({ value: z.int().nullable(), note: z.string().nullable() });
const choiceWithNote = chosenOptionSchema.nullable();

const person = z.object({ id: z.uuid(), name: z.string() });

/** A log in a list. */
export const logSummarySchema = z
  .object({
    id: z.uuid(),
    bookingId: z.uuid(),
    branch: branchRefSchema,
    customer: z.object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() }),
    trainer: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }),
    /** The day of the session. */
    sessionDate: instant,
    plan: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    goal: z.string().nullable(),
    exercises: z.int(),
    sets: z.int(),
    updatedAt: instant,
  })
  .meta({ id: "WorkoutLogSummary" });

export const logPageSchema = pageOf(logSummarySchema).meta({ id: "WorkoutLogPage" });

/** A log with everything under it. */
export const logSchema = logSummarySchema
  .extend({
    contract: z.object({ id: z.uuid(), contractCode: z.string() }),
    planSession: z.object({ id: z.uuid(), week: z.int().nullable(), number: z.int().nullable() }).nullable(),
    pre: z.object({ stress: scaleWithNote, energy: scaleWithNote, impact: choiceWithNote }),
    post: z.object({ srpe: scaleWithNote, energy: scaleWithNote, summary: choiceWithNote }),
    coachNotes: z.string().nullable(),
    createdBy: person,
    updatedBy: person.nullable(),
    createdAt: instant,
    /** Whether the reader may write it. */
    canEdit: z.boolean(),
    items: z.array(logItemSchema),
  })
  .meta({ id: "WorkoutLog" });

export type LogSummary = z.output<typeof logSummarySchema>;
export type LogPage = z.output<typeof logPageSchema>;
export type Log = z.output<typeof logSchema>;
export type LogItem = z.output<typeof logItemSchema>;
export type LogSet = z.output<typeof logSetSchema>;
