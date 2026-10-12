import { z } from "zod";
import { calendarDate } from "../validation/index.js";
import { AUDIT_CRITERIA_KEYS } from "./audit.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** A criterion's switch and weight, 1 to 10 (A-083). */
export const criterionInputSchema = z.object({
  key: z.enum(AUDIT_CRITERIA_KEYS, { error: "invalidChoice" }),
  active: z.boolean({ error: "invalidChoice" }),
  weight: z
    .int({ error: "invalidNumber" })
    .min(1, { error: "weightOutOfRange" })
    .max(10, { error: "weightOutOfRange" }),
});

/** All criteria at once, each once. */
export const criteriaInputSchema = z.object({
  criteria: z
    .array(criterionInputSchema)
    .length(AUDIT_CRITERIA_KEYS.length, { error: "invalidChoice" })
    .refine((list) => new Set(list.map((item) => item.key)).size === list.length, { error: "invalidChoice" }),
});

/** Narrows the audit to leads created in a period, as gym days (A-082). */
const period = {
  from: optional(calendarDate),
  to: optional(calendarDate),
};

export const auditConsultantsQuerySchema = z.object(period);

export const auditLeadsQuerySchema = z.object({
  /** The person in charge. */
  consultantId: optional(z.uuid({ error: "invalidChoice" })),
  ...period,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CriteriaInput = z.input<typeof criteriaInputSchema>;
