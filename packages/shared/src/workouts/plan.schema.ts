import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { hasNoControlCharacters } from "../validation/index.js";
import { PLAN_KINDS, PLAN_LIMITS, PLAN_STATUSES } from "./plan.domain.js";

// Workout plans and templates (M7.2, brief §7.1, §7.2): inputs. Error messages are i18n keys under `validation.*`.

const emptyToNull = (value: string) => (value === "" ? null : value);
export const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });
export const optionalText = (max: number) => text(max).transform(emptyToNull).nullable().prefault("");
const name = text(150).pipe(z.string().min(1, { error: "required" }));
export const optionalUuid = z
  .union([z.literal(""), z.null(), z.uuid({ error: "invalidChoice" })])
  .transform((value) => (value === "" ? null : value));

/** A number typed in a form: "" or nothing is empty, "12,5" is 12.5; anything else must be a number in range. */
export function target(min: number, max: number, options: { integer?: boolean } = {}) {
  return z
    .union([z.number(), z.string(), z.null()], { error: "invalidNumber" })
    .transform((value, ctx): number | null => {
      if (value === null || (typeof value === "string" && value.trim() === "")) return null;
      const number = typeof value === "number" ? value : Number(value.trim().replace(",", "."));
      const refuse = (message: string) => {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      };
      if (!Number.isFinite(number)) return refuse("invalidNumber");
      if (options.integer && !Number.isInteger(number)) return refuse("invalidNumber");
      if (number < min || number > max) return refuse("outOfRange");
      // Two decimals at most, as the columns hold.
      if (!options.integer && Math.abs(number * 100 - Math.round(number * 100)) > 1e-6)
        return refuse("tooManyDecimals");
      return number;
    })
    .prefault(null);
}

const videoUrl = z
  .union([z.literal(""), z.url({ protocol: /^https$/, error: "invalidUrl" }).max(500, { error: "tooLong" })])
  .transform(emptyToNull)
  .nullable()
  .prefault("");

/** One set's targets; which fields apply is the exercise's kind (the API checks). */
export const planSetInputSchema = z.object({
  weight: target(0, 1000),
  reps: target(1, 1000, { integer: true }),
  restSeconds: target(0, 3600, { integer: true }),
  rir: target(0, 10, { integer: true }),
  tempo: optionalText(20),
  technique: optionalText(200),
  videoUrl,
  durationMinutes: target(0.1, 600),
  speed: target(0, 60),
  heartRate: target(30, 250, { integer: true }),
  notes: optionalText(500),
});

export const planItemInputSchema = z.object({
  exerciseId: z.uuid({ error: "required" }),
  sets: z.array(planSetInputSchema).max(PLAN_LIMITS.setsPerItem, { error: "tooMany" }),
});

export const planSessionInputSchema = z.object({
  /** The week of the plan and the session's number in it; both empty in a template. */
  week: target(1, 104, { integer: true }),
  number: target(1, 14, { integer: true }),
  goal: optionalText(300),
  items: z.array(planItemInputSchema).max(PLAN_LIMITS.itemsPerSession, { error: "tooMany" }),
});

export const planStageInputSchema = z.object({
  stageId: z.uuid({ error: "required" }),
  sessions: z.array(planSessionInputSchema).max(PLAN_LIMITS.sessionsPerStage, { error: "tooMany" }),
});

/** The whole content of a plan or template, saved as one: the header and the stages with everything under them. */
export const planContentSchema = z.object({
  name,
  phase: optionalText(100),
  goal: optionalText(500),
  notes: optionalText(2000),
  /** A template can be retired; ignored for a customer plan. */
  active: z.boolean({ error: "invalidChoice" }).prefault(true),
  stages: z.array(planStageInputSchema).max(PLAN_LIMITS.stages, { error: "tooMany" }),
});

/** A new template, or a customer's plan blank or from a template with the weeks and sessions per week to make. */
export const planCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEMPLATE"), name, notes: optionalText(2000), branchId: branchChoice }),
  z.object({
    kind: z.literal("CUSTOMER"),
    name: optionalText(150),
    customerId: z.uuid({ error: "required" }),
    contractId: z.uuid({ error: "required" }),
    /** A manager names the coach; a PT's plan is their own. */
    trainerId: optionalUuid.prefault(""),
    templateId: optionalUuid.prefault(""),
    weeksPerStage: z.coerce.number().int().min(1, { error: "outOfRange" }).max(26, { error: "outOfRange" }).prefault(4),
    sessionsPerWeek: z.coerce
      .number()
      .int()
      .min(1, { error: "outOfRange" })
      .max(7, { error: "outOfRange" })
      .prefault(3),
  }),
]);

/** Evaluations and notes of the two reviewers (brief §7.2): the coach, and the Master. */
export const planReviewSchema = z.object({
  side: z.enum(["PT", "MASTER"], { error: "invalidChoice" }),
  evaluation: optionalText(1000),
  note: optionalText(1000),
});

export const planListQuerySchema = z.object({
  kind: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(PLAN_KINDS, { error: "invalidChoice" }).optional(),
  ),
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(PLAN_STATUSES, { error: "invalidChoice" }).optional(),
  ),
  customerId: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.uuid({ error: "invalidChoice" }).optional(),
  ),
  trainerId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "invalidChoice" }).optional()),
  q: text(100).prefault(""),
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type PlanContentInput = z.input<typeof planContentSchema>;
export type PlanContent = z.output<typeof planContentSchema>;
export type PlanCreateInput = z.input<typeof planCreateSchema>;
export type PlanReviewInput = z.input<typeof planReviewSchema>;
export type PlanSetInput = z.input<typeof planSetInputSchema>;
