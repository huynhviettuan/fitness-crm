import { z } from "zod";
import { hasNoControlCharacters } from "../validation/index.js";
import { type LEAD_STATUSES } from "./lead.schema.js";

// The consulting checklist (brief §4.1, D-020, FR-LEAD-004). What can open a step is code
// (D-015); the steps, their names, delays, results, and whether they are required are
// configuration, saved as a new version that applies to new leads only.

/**
 * What opens a step and sets its deadline:
 * - ASSIGNED: the lead is first given to someone; deadline = then + offset.
 * - STATUS: the lead enters `triggerStatus`; deadline = then + offset. Leaving the status first closes it.
 * - APPOINTMENT: the appointment is booked or moved; deadline = appointment + offset (negative: before).
 *   Calling the appointment off closes it.
 * - AFTER_STEP: the step `triggerStepKey` is done; deadline = then + offset.
 * - RECARE: the lead enters No response, Refused, or No show; deadline = its contact-again day (BR-204).
 */
export const STEP_TRIGGERS = ["ASSIGNED", "STATUS", "APPOINTMENT", "AFTER_STEP", "RECARE"] as const;
export type StepTrigger = (typeof STEP_TRIGGERS)[number];

/** How an admin enters a delay; stored as minutes. */
export const OFFSET_UNITS = ["MINUTES", "HOURS", "DAYS"] as const;
export type OffsetUnit = (typeof OFFSET_UNITS)[number];
const MINUTES_PER: Record<OffsetUnit, number> = { MINUTES: 1, HOURS: 60, DAYS: 1440 };

/** A step is waiting for its trigger, open with a deadline, or done. */
export const STEP_STATES = ["WAITING", "OPEN", "DONE"] as const;
export type StepState = (typeof STEP_STATES)[number];

/** A done step was done by its deadline or after it (brief §4.1 audit; "skipped" is M3). */
export const STEP_TIMINGS = ["ON_TIME", "LATE"] as const;
export type StepTiming = (typeof STEP_TIMINGS)[number];

/** Statuses a STATUS step can wait for: those a lead enters during its journey. */
export const STEP_TRIGGER_STATUSES = [
  "CONSULTING",
  "CONSIDERING",
  "NO_RESPONSE",
  "BOOKED",
  "SHOWED",
  "NO_SHOW",
  "REFUSED",
  "CONTRACTED",
] as const satisfies readonly (typeof LEAD_STATUSES)[number][];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    .refine(hasNoControlCharacters, { error: "invalidCharacters" })
    .pipe(z.string().min(1, { error: "required" }));

const emptyToNull = (value: string) => (value === "" ? null : value);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === "" ? null : value), z.enum(values, { error: "invalidChoice" }).nullable());

const result = z.object({ labelVi: text(60), labelEn: text(60) });

const stepInput = z.object({
  /** Stable within the checklist; AFTER_STEP refers to it. */
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, { error: "invalidKey" }),
  labelVi: text(100),
  labelEn: text(100),
  trigger: z.enum(STEP_TRIGGERS, { error: "invalidChoice" }),
  triggerStatus: optionalEnum(STEP_TRIGGER_STATUSES).prefault(""),
  triggerStepKey: z.string().trim().transform(emptyToNull).prefault(""),
  /** 0 to 999 units; for APPOINTMENT it counts back from the appointment. Unused for RECARE. */
  offsetValue: z.coerce
    .number({ error: "invalidNumber" })
    .int({ error: "invalidNumber" })
    .min(0, { error: "invalidNumber" })
    .max(999, { error: "invalidNumber" }),
  offsetUnit: z.enum(OFFSET_UNITS, { error: "invalidChoice" }),
  required: z.boolean({ error: "invalidChoice" }).prefault(false),
  /** What opens the step also does it, e.g. booking the visit is "Đặt lịch": done with the first result, on time. */
  autoComplete: z.boolean({ error: "invalidChoice" }).prefault(false),
  results: z.array(result).min(1, { error: "required" }).max(10, { error: "tooLong" }),
});

/** Saving the checklist makes a new version (D-020). */
export const checklistInputSchema = z
  .object({ steps: z.array(stepInput).min(1, { error: "required" }).max(30, { error: "tooLong" }) })
  .superRefine(({ steps }, ctx) => {
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      if (seen.has(step.key)) ctx.addIssue({ code: "custom", path: ["steps", index, "key"], message: "duplicate" });
      if (step.trigger === "STATUS" && !step.triggerStatus) {
        ctx.addIssue({ code: "custom", path: ["steps", index, "triggerStatus"], message: "required" });
      }
      // A step can only follow one listed before it, so the checklist never waits on itself.
      if (step.trigger === "AFTER_STEP" && !(step.triggerStepKey && seen.has(step.triggerStepKey))) {
        ctx.addIssue({ code: "custom", path: ["steps", index, "triggerStepKey"], message: "invalidChoice" });
      }
      seen.add(step.key);
    });
  })
  .transform(({ steps }) => ({
    steps: steps.map(({ offsetValue, offsetUnit, ...step }) => ({
      ...step,
      triggerStatus: step.trigger === "STATUS" ? step.triggerStatus : null,
      triggerStepKey: step.trigger === "AFTER_STEP" ? step.triggerStepKey : null,
      offsetMinutes:
        step.trigger === "RECARE"
          ? 0
          : offsetValue * MINUTES_PER[offsetUnit] * (step.trigger === "APPOINTMENT" ? -1 : 1),
    })),
  }));

/** Completing a step: one of its results, and an optional note that never replaces it. */
export const stepCompleteSchema = z.object({
  resultIndex: z.coerce
    .number({ error: "required" })
    .int({ error: "invalidChoice" })
    .min(0, { error: "invalidChoice" }),
  note: z
    .string()
    .trim()
    .max(1000, { error: "tooLong" })
    .refine(hasNoControlCharacters, { error: "invalidCharacters" })
    .transform(emptyToNull)
    .prefault(""),
});

export const todayStepsQuerySchema = z.object({
  /** Mine: leads in my charge; all: every lead I may see. */
  scope: z.enum(["mine", "all"], { error: "invalidChoice" }).prefault("mine"),
});

/** A stored offset shown the way an admin would enter it. */
export function offsetParts(offsetMinutes: number): { offsetValue: number; offsetUnit: OffsetUnit } {
  const minutes = Math.abs(offsetMinutes);
  if (minutes !== 0 && minutes % MINUTES_PER.DAYS === 0)
    return { offsetValue: minutes / MINUTES_PER.DAYS, offsetUnit: "DAYS" };
  if (minutes !== 0 && minutes % MINUTES_PER.HOURS === 0)
    return { offsetValue: minutes / MINUTES_PER.HOURS, offsetUnit: "HOURS" };
  return { offsetValue: minutes, offsetUnit: "MINUTES" };
}

export type ChecklistInput = z.input<typeof checklistInputSchema>;
export type ChecklistData = z.output<typeof checklistInputSchema>;
export type StepCompleteInput = z.input<typeof stepCompleteSchema>;
