import { z } from "zod";
import { hasNoControlCharacters } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/** A manager's grade of a lead's consulting (brief §4.1, FR-LEAD-011; A-086, A-087). */
export const AUDIT_RESULTS = ["PASS", "FAIL"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/**
 * A Fail names the criteria not met, from the list "auditFailReasons"; a Pass names none. The
 * comment is optional, except with the criterion "Khác", which the API checks (D-016).
 */
export const managerAuditInputSchema = z
  .object({
    result: z.enum(AUDIT_RESULTS, { error: "invalidChoice" }),
    criterionIds: z
      .array(z.uuid({ error: "invalidChoice" }))
      .max(50, { error: "tooLong" })
      .prefault([]),
    comment: z
      .string()
      .trim()
      .max(2000, { error: "tooLong" })
      .refine(hasNoControlCharacters, { error: "invalidCharacters" })
      .transform((value) => (value === "" ? null : value))
      .prefault(""),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.criterionIds).size !== value.criterionIds.length) {
      ctx.addIssue({ code: "custom", path: ["criterionIds"], message: "invalidChoice" });
    } else if (value.result === "FAIL" && value.criterionIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["criterionIds"], message: "required" });
    } else if (value.result === "PASS" && value.criterionIds.length > 0) {
      ctx.addIssue({ code: "custom", path: ["criterionIds"], message: "noCriteriaOnPass" });
    }
  });

export type ManagerAuditInput = z.input<typeof managerAuditInputSchema>;
