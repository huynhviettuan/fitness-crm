import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { VOUCHER_KINDS, VOUCHER_STATUSES } from "./change.domain.js";

// Contract change vouchers (M8, brief §5.6): responses.

const person = z.object({ id: z.uuid(), name: z.string() });

export const voucherSchema = z
  .object({
    id: z.uuid(),
    voucherNumber: z.string(),
    kind: z.enum(VOUCHER_KINDS),
    status: z.enum(VOUCHER_STATUSES),
    contract: z.object({ id: z.uuid(), contractCode: z.string() }),
    customer: z.object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() }),
    branch: branchRefSchema,
    /** The kind's own fields; empty where the kind has none. */
    fromDate: instant.nullable(),
    toDate: instant.nullable(),
    months: z.int().nullable(),
    days: z.int().nullable(),
    sessions: z.int().nullable(),
    amount: z.int().nullable(),
    /** An upgrade or a conversion: the service exchanged for, and the value credited for the sessions left. */
    targetService: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    credit: z.int().nullable(),
    reason: chosenOptionSchema.nullable(),
    note: z.string().nullable(),
    /** What approving it did, set at approval: sessions and value added to the contract and the end dates. */
    sessionsDelta: z.int(),
    valueDelta: z.int(),
    endDateBefore: instant.nullable(),
    endDateAfter: instant.nullable(),
    createdBy: person,
    createdAt: instant,
    approvedBy: person.nullable(),
    approvedAt: instant.nullable(),
    /** The request waiting for an approver, while the voucher is pending. */
    pendingRequestId: z.uuid().nullable(),
  })
  .meta({ id: "ChangeVoucher" });

export const voucherPageSchema = pageOf(voucherSchema).meta({ id: "ChangeVoucherPage" });

export type Voucher = z.output<typeof voucherSchema>;
export type VoucherPage = z.output<typeof voucherPageSchema>;
