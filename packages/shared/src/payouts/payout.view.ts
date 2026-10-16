import { z } from "zod";
import { RECORD_APPROVAL_STATUSES } from "../approvals/approval.schema.js";
import { branchRefSchema } from "../branches/branch.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { PAYOUT_LINE_KINDS } from "./payout.domain.js";

const trainer = z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() });

export const ptPayoutSchema = z
  .object({
    id: z.uuid(),
    /** The number of the expense voucher the payout made (D-034). */
    number: z.string(),
    branch: branchRefSchema,
    trainer,
    periodFrom: instant,
    periodTo: instant,
    /** The voucher's amount: the sessions paid less the adjustments applied. */
    amount: z.int(),
    sessionAmount: z.int(),
    /** Negative or zero: paid sessions taken back (D-027). */
    adjustmentAmount: z.int(),
    sessionCount: z.int(),
    adjustmentCount: z.int(),
    /** The voucher's approval; a pending payout already holds its sessions (D-018). */
    approvalStatus: z.enum(RECORD_APPROVAL_STATUSES),
    /** The voucher was deleted or rejected: the sessions are payable again. */
    void: z.boolean(),
    createdAt: instant,
    createdBy: z.string(),
  })
  .meta({ id: "PtPayout" });

export const ptPayoutLineSchema = z.object({
  id: z.uuid(),
  kind: z.enum(PAYOUT_LINE_KINDS),
  amount: z.int(),
  /** The payout stands no more, so the line pays nothing. */
  released: z.boolean(),
  booking: z.object({ id: z.uuid(), scheduledStart: instant }),
  customer: z.object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() }),
  contract: z.object({ id: z.uuid(), contractCode: z.string() }),
});

export const ptPayoutDetailSchema = ptPayoutSchema
  .extend({ lines: z.array(ptPayoutLineSchema) })
  .meta({ id: "PtPayoutDetail" });

export const ptPayoutPageSchema = pageOf(ptPayoutSchema).meta({ id: "PtPayoutPage" });

export type PtPayout = z.output<typeof ptPayoutSchema>;
export type PtPayoutLine = z.output<typeof ptPayoutLineSchema>;
export type PtPayoutDetail = z.output<typeof ptPayoutDetailSchema>;
export type PtPayoutPage = z.output<typeof ptPayoutPageSchema>;
