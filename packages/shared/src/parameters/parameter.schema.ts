import { z } from "zod";
import { timeOfDay } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/**
 * System parameters (T-049): values the flows read and admin changes on screen. The
 * keys are code; the values live in the database. Defaults are the brief's initial
 * values and apply until admin saves another value. Parameters are added with the
 * features that read them.
 */
export const PARAMETER_DEFAULTS = {
  /** First and last time on the PT calendar (D-030). */
  calendarDayStart: "05:00",
  calendarDayEnd: "22:00",
  /** Prefixes of generated codes (D-038); the number after them never repeats. */
  leadCodePrefix: "LD",
  customerCodePrefix: "KH",
  contractCodePrefix: "HD",
  employeeCodePrefix: "NV",
  /** How many hours before its deadline a task reminds its assignee (brief §8.2, A-046). */
  taskDueSoonHours: "24",
  /** Days after No response, Refused, or No show before the lead is contacted again (BR-204, OQ-018). */
  recareDays: "15",
} as const;

export type ParameterKey = keyof typeof PARAMETER_DEFAULTS;
export const PARAMETER_KEYS = Object.keys(PARAMETER_DEFAULTS) as ParameterKey[];

/** The calendar is drawn in 30-minute cells (D-030), so its hours fall on them. */
const calendarTime = timeOfDay.refine((value) => value.endsWith(":00") || value.endsWith(":30"), { error: "notOnHalfHour" });

const codePrefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,5}$/, { error: "invalidCodePrefix" });

/** Whole hours, 1 to 168 (a week), kept as text like every parameter. */
const hours = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) >= 1 && Number(value) <= 168, { error: "outOfRange" })
  .transform((value) => String(Number(value)));

/** Whole days, 1 to 365. */
const days = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) >= 1 && Number(value) <= 365, { error: "daysOutOfRange" })
  .transform((value) => String(Number(value)));

export const parametersInputSchema = z
  .object({
    calendarDayStart: calendarTime,
    calendarDayEnd: calendarTime,
    leadCodePrefix: codePrefix,
    customerCodePrefix: codePrefix,
    contractCodePrefix: codePrefix,
    employeeCodePrefix: codePrefix,
    taskDueSoonHours: hours,
    recareDays: days,
  })
  .refine((value) => value.calendarDayEnd > value.calendarDayStart, { path: ["calendarDayEnd"], error: "endTimeNotAfterStart" });

export const parametersSchema = z
  .object({
    calendarDayStart: z.string(),
    calendarDayEnd: z.string(),
    leadCodePrefix: z.string(),
    customerCodePrefix: z.string(),
    contractCodePrefix: z.string(),
    employeeCodePrefix: z.string(),
    taskDueSoonHours: z.string(),
    recareDays: z.string(),
  })
  .meta({ id: "Parameters" });

export type ParametersInput = z.input<typeof parametersInputSchema>;
export type Parameters = z.output<typeof parametersSchema>;

/** "05:30" → 330. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** A generated code: the prefix and at least `digits` digits (D-038), e.g. KH000123. */
export function formatCode(prefix: string, sequenceValue: bigint | number, digits: number): string {
  return `${prefix}${sequenceValue.toString().padStart(digits, "0")}`;
}
