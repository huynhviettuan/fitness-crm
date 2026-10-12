import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { AUDIT_CRITERIA_KEYS, STEP_OUTCOMES } from "./audit.domain.js";
import { LEAD_STATUSES } from "./lead.schema.js";

const person = z.object({ id: z.uuid(), name: z.string() });

/** The figures every level of the audit shows (A-082). */
const totals = {
  onTime: z.int(),
  late: z.int(),
  skipped: z.int(),
  /** Due steps: on time, late, and skipped. */
  due: z.int(),
  /** On-time steps as a percentage of the due ones; null when none is due. */
  compliance: z.int().nullable(),
  /** The audit score, in percent; null when there is nothing to check. */
  score: z.int().nullable(),
};

export const criterionSchema = z
  .object({ key: z.enum(AUDIT_CRITERIA_KEYS), active: z.boolean(), weight: z.int() })
  .meta({ id: "AuditCriterion" });

export const criteriaListSchema = z.object({ items: z.array(criterionSchema) }).meta({ id: "AuditCriteria" });

/** The audit of one lead: its steps with how each went, and its criteria (A-081, A-083). */
export const leadAuditSchema = z
  .object({
    ...totals,
    steps: z.array(
      z.object({
        key: z.string(),
        labelVi: z.string(),
        labelEn: z.string(),
        required: z.boolean(),
        dueAt: instant.nullable(),
        doneAt: instant.nullable(),
        /** Null when the step is not due yet or waits for its trigger. */
        outcome: z.enum(STEP_OUTCOMES).nullable(),
      }),
    ),
    criteria: z.array(
      z.object({
        key: z.enum(AUDIT_CRITERIA_KEYS),
        weight: z.int(),
        /** Switched off by admin: not part of the score. */
        active: z.boolean(),
        /** Whether the criterion applies to this lead. */
        applies: z.boolean(),
        /** Null when it does not apply, or the user may not see the field (D-017). */
        passed: z.boolean().nullable(),
      }),
    ),
  })
  .meta({ id: "LeadAudit" });

/** One consultant's figures over the leads they are in charge of (A-082). */
export const consultantAuditRowSchema = z
  .object({
    /** Null for leads nobody is in charge of. */
    consultant: person.nullable(),
    leads: z.int(),
    ...totals,
    /** Leads with a late or skipped step or a failed criterion (A-085). */
    toCheck: z.int(),
    /** People with no manager audit yet (A-088). */
    unaudited: z.int(),
  })
  .meta({ id: "ConsultantAuditRow" });

export const consultantAuditSchema = z
  .object({ items: z.array(consultantAuditRowSchema), team: z.object({ leads: z.int(), ...totals }) })
  .meta({ id: "ConsultantAudit" });

/** A row of "Leads to check", most urgent first (A-085). */
export const leadToCheckSchema = z
  .object({
    id: z.uuid(),
    leadCode: z.string(),
    fullName: z.string(),
    status: z.enum(LEAD_STATUSES),
    pic: person.nullable(),
    branch: branchRefSchema,
    createdAt: instant,
    late: z.int(),
    skipped: z.int(),
    failed: z.array(z.enum(AUDIT_CRITERIA_KEYS)),
    score: z.int().nullable(),
  })
  .meta({ id: "LeadToCheck" });

export const leadsToCheckPageSchema = pageOf(leadToCheckSchema).meta({ id: "LeadsToCheckPage" });

export type LeadAudit = z.output<typeof leadAuditSchema>;
export type AuditCriterion = z.output<typeof criterionSchema>;
export type ConsultantAudit = z.output<typeof consultantAuditSchema>;
export type LeadToCheck = z.output<typeof leadToCheckSchema>;
export type LeadsToCheckPage = z.output<typeof leadsToCheckPageSchema>;
