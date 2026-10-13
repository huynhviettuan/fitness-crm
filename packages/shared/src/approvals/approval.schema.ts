import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema, optionChoice, optionNote } from "../options/option.schema.js";
import { instant, listOf, pageOf } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/**
 * The actions an approval matrix can cover (D-018). The flow is fixed: submit, pending
 * without effect, approve or reject by someone else. Which actions need approval, and
 * who approves, is configuration. Actions are added with the features that have them.
 */
// "contract.create" is a new contract waiting for approval (M4.4, A-120).
export const APPROVAL_ACTIONS = [
  "payment.create",
  "cash.create",
  "record.delete",
  "customer.identity",
  "contract.create",
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** The status of a record that can need approval; it has an effect only when APPROVED. */
export const RECORD_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type RecordApprovalStatus = (typeof RECORD_APPROVAL_STATUSES)[number];

/** One row of the approval matrix (FR-PLT-006/007). */
export const approvalRuleInputSchema = z
  .object({
    required: z.boolean({ error: "invalidChoice" }),
    approverRoleIds: z.array(z.uuid({ error: "invalidChoice" })).max(50, { error: "tooLong" }),
    /** After this long a pending request is overdue (reminders arrive with notifications). */
    overdueHours: z.coerce
      .number({ error: "invalidNumber" })
      .int({ error: "invalidNumber" })
      .min(1, { error: "outOfRange" })
      .max(720, { error: "outOfRange" }),
  })
  .refine((rule) => !rule.required || rule.approverRoleIds.length > 0, {
    path: ["approverRoleIds"],
    error: "approverRequired",
  });

export const approvalRuleSchema = z
  .object({
    action: z.enum(APPROVAL_ACTIONS),
    required: z.boolean(),
    approvers: z.array(z.object({ id: z.uuid(), name: z.string() })),
    overdueHours: z.int(),
  })
  .meta({ id: "ApprovalRule" });

export const approvalRuleListSchema = listOf(approvalRuleSchema).meta({ id: "ApprovalRuleList" });

/** Rejecting needs a reason from the "rejectReasons" list (D-018, D-016). */
export const rejectSchema = z.object({ reasonId: optionChoice, reasonNote: optionNote });

export const APPROVAL_VIEWS = ["toDecide", "mine", "all"] as const;

export const listApprovalsSchema = z.object({
  /** toDecide: what the user may decide; mine: what they submitted; all: needs approval.manage. */
  view: z.enum(APPROVAL_VIEWS, { error: "invalidChoice" }).optional().default("toDecide"),
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(APPROVAL_STATUSES, { error: "invalidChoice" }).optional(),
  ),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/** A request as the inbox shows it. */
export const approvalRequestSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(APPROVAL_ACTIONS),
    entityType: z.string(),
    entityId: z.uuid(),
    branch: branchRefSchema,
    /** A short name for the record, e.g. "HD000012 · Nguyễn Văn An". */
    title: z.string(),
    /** Null when there is no amount, or receipt totals are hidden from the viewer (D-017). */
    amount: z.int().nullable(),
    /** What approval would change, e.g. a customer's new phone number. */
    changes: z.record(z.string(), z.unknown()),
    status: z.enum(APPROVAL_STATUSES),
    submittedBy: z.object({ id: z.uuid(), name: z.string() }),
    submittedAt: instant,
    decidedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    decidedAt: instant.nullable(),
    rejectReason: chosenOptionSchema.nullable(),
    /** Pending longer than the rule's overdue time. */
    overdue: z.boolean(),
    /** The viewer may approve or reject it now. */
    canDecide: z.boolean(),
  })
  .meta({ id: "ApprovalRequest" });

export const approvalRequestPageSchema = pageOf(approvalRequestSchema).meta({ id: "ApprovalRequestPage" });

/** For the top bar: how many requests wait for the user. */
export const approvalSummarySchema = z.object({ toDecide: z.int(), overdue: z.int() }).meta({ id: "ApprovalSummary" });

/** What an action under approval answers with 202: the request it created. */
export const submittedSchema = z
  .object({ approval: z.object({ id: z.uuid(), status: z.literal("PENDING") }) })
  .meta({ id: "SubmittedForApproval" });

export type ApprovalRuleInput = z.input<typeof approvalRuleInputSchema>;
export type ApprovalRule = z.output<typeof approvalRuleSchema>;
export type ApprovalRequest = z.output<typeof approvalRequestSchema>;
export type RejectInput = z.input<typeof rejectSchema>;
