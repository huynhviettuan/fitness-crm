import { z } from "zod";
import { calendarDate } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** The cohort of a consulting report: people created in the period, in a branch, of a person in charge (A-089). */
export const reportQuerySchema = z.object({
  from: optional(calendarDate),
  to: optional(calendarDate),
  branchId: optional(z.uuid({ error: "invalidChoice" })),
  staffId: optional(z.uuid({ error: "invalidChoice" })),
});

/** The dimensions of the lead analysis (A-092). */
export const ANALYSIS_DIMENSIONS = [
  "channel",
  "source",
  "sourceType",
  "needGroup",
  "nationalityGroup",
  "country",
  "refuseReason",
] as const;
export type AnalysisDimension = (typeof ANALYSIS_DIMENSIONS)[number];

export type ReportQuery = z.input<typeof reportQuerySchema>;
