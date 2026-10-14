import { z } from "zod";
import { optionChoice } from "../options/option.schema.js";
import { LOG_LIMITS, LOG_SCALE } from "./log.domain.js";
import { optionalText, optionalUuid, target } from "./plan.schema.js";

// The session log (M7.3, brief §7.3, FR-WKO-003): inputs. Error messages are i18n keys under `validation.*`.

const scale = target(LOG_SCALE.min, LOG_SCALE.max, { integer: true });
const optionalChoice = optionalUuid.prefault("");

/** One set: what was done (Strength: weight, reps, RIR; Cardio: time, speed, heart rate), its Flag and Action, and a note. */
export const logSetInputSchema = z.object({
  /** The set being kept; none for a set the coach adds. */
  id: z.uuid({ error: "invalidChoice" }).optional(),
  weight: target(0, 1000),
  reps: target(0, 1000, { integer: true }),
  rir: target(0, 10, { integer: true }),
  durationMinutes: target(0, 600),
  speed: target(0, 60),
  heartRate: target(0, 250, { integer: true }),
  flagId: optionChoice,
  flagNote: optionalText(500),
  actionId: optionChoice,
  actionNote: optionalText(500),
  note: optionalText(500),
});

export const logItemInputSchema = z.object({
  /** The exercise row being kept; none for an exercise the coach adds. */
  id: z.uuid({ error: "invalidChoice" }).optional(),
  exerciseId: z.uuid({ error: "required" }),
  sets: z.array(logSetInputSchema).max(LOG_LIMITS.setsPerItem, { error: "tooMany" }),
});

/** The whole log, saved as one: the three parts and the rows. */
export const logContentSchema = z.object({
  goal: optionalText(300),
  preStress: scale,
  preStressNote: optionalText(500),
  preEnergy: scale,
  preEnergyNote: optionalText(500),
  preImpactId: optionalChoice,
  preImpactNote: optionalText(500),
  postSrpe: scale,
  postSrpeNote: optionalText(500),
  postEnergy: scale,
  postEnergyNote: optionalText(500),
  postSummaryId: optionalChoice,
  postSummaryNote: optionalText(500),
  coachNotes: optionalText(2000),
  items: z.array(logItemInputSchema).max(LOG_LIMITS.itemsPerLog, { error: "tooMany" }),
});

/** A log is opened from a PT session; it follows the next planned session unless the coach names another. */
export const logCreateSchema = z.object({
  bookingId: z.uuid({ error: "required" }),
  planSessionId: optionalUuid.prefault(""),
});

const blankIsNothing = (value: unknown) => (value === "" ? undefined : value);

export const logListQuerySchema = z.object({
  customerId: z.preprocess(blankIsNothing, z.uuid({ error: "invalidChoice" }).optional()),
  trainerId: z.preprocess(blankIsNothing, z.uuid({ error: "invalidChoice" }).optional()),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type LogContentInput = z.input<typeof logContentSchema>;
export type LogContent = z.output<typeof logContentSchema>;
export type LogCreateInput = z.input<typeof logCreateSchema>;
export type LogSetInput = z.input<typeof logSetInputSchema>;
export type LogItemInput = z.input<typeof logItemInputSchema>;
