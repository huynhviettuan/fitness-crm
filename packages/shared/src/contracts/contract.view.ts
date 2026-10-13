import { z } from "zod";
import { auditEventSchema } from "../audit/audit.schema.js";
import { branchRefSchema } from "../branches/branch.schema.js";
import { customerRefSchema } from "../customers/customer.view.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, listOf, pageOf } from "../validation/index.js";
import { CONTRACT_STATUSES, CONTRACT_TYPES, STAFF_ROLES } from "./contract.domain.js";

/** One staff member's share (A-115). */
export const contractShareSchema = z.object({
  role: z.enum(STAFF_ROLES),
  employee: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }),
  percent: z.number(),
});

/** What the UI and API see: plain numbers and the effective status (T-018). */
export const contractSchema = z
  .object({
    id: z.uuid(),
    contractCode: z.string(),
    customer: customerRefSchema,
    /** Null when the role cannot see customers' phones (D-017). */
    customerPhone: z.string().nullable(),
    branch: branchRefSchema,
    /** The display name: the service and the real session count, e.g. "Hybrid Training 30 buổi" (D-021). */
    packageName: z.string(),
    service: z.object({ id: z.uuid(), name: z.string(), kind: z.enum(["PT", "CLASS", "MEMBER"]) }).nullable(),
    contractType: z.enum(CONTRACT_TYPES),
    previousContract: z.object({ id: z.uuid(), contractCode: z.string() }).nullable(),
    contractDate: instant,
    startDate: instant,
    endDate: instant,
    activationDeadline: instant.nullable(),
    status: z.enum([...CONTRACT_STATUSES, "EXPIRED"]),
    createdAt: instant,
    // What was bought, and the bonus kept apart (brief §5.1).
    sessionsBought: z.int(),
    bonusSessions: z.int(),
    bonusMonths: z.int(),
    bonusDays: z.int(),
    // The price (BR-301, BR-302): the tier's, the approved one, the discounts and VAT.
    tierUnitPrice: z.int().nullable(),
    approvedUnitPrice: z.int(),
    isExceptionPrice: z.boolean(),
    exceptionReason: chosenOptionSchema.nullable(),
    exceptionNote: z.string().nullable(),
    promotion: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    voucher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    promotionDiscount: z.int(),
    voucherDiscount: z.int(),
    vatPercent: z.number(),
    vatAmount: z.int(),
    /** Total discount against the tier price, in percent (A-112). */
    discountPercent: z.number(),
    shares: z.array(contractShareSchema),
    companions: z.array(customerRefSchema),
    signed: z.boolean(),
    signedOn: instant.nullable(),
    signedBy: z.string().nullable(),
    signatureNote: z.string().nullable(),
    paymentDueOn: instant.nullable(),
    notes: z.string().nullable(),
    /** Brought over from before the tiers (M4.3): its price is flagged as an exception and it has no service. */
    isImported: z.boolean(),
    createdBy: z.object({ id: z.uuid(), name: z.string() }),
    /** Who approved it and when (A-121); null while pending, rejected, or brought over. */
    approvedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    approvedAt: instant.nullable(),
    /** Set when the status is REJECTED: who turned it down, when, and why (A-121). */
    rejection: z
      .object({ by: z.object({ id: z.uuid(), name: z.string() }), at: instant, reason: chosenOptionSchema })
      .nullable(),
    /** Whether a request waits for an approver (A-120). */
    approvalPending: z.boolean(),
    // Derived figures (T-012, BR-013, D-011). `totalSessions` is bought plus bonus.
    totalSessions: z.int(),
    openingSessionsUsed: z.int(),
    completedSessions: z.int(),
    remainingSessions: z.int(),
    contractValue: z.int(),
    openingPaidAmount: z.int(),
    confirmedPaidAmount: z.int(),
    paidAmount: z.int(),
    debt: z.int(),
  })
  .meta({ id: "Contract" });

/** The employees who can be named on a contract of a branch (A-115): active staff, trainers marked. */
export const contractStaffSchema = z
  .object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string(), isTrainer: z.boolean() })
  .meta({ id: "ContractStaff" });
export const contractStaffListSchema = listOf(contractStaffSchema).meta({ id: "ContractStaffList" });
export type ContractStaff = z.output<typeof contractStaffSchema>;

/** The list's money over everything it filters, not only the page (brief §5.3); null when receipt totals are hidden. */
export const contractTotalsSchema = z
  .object({ contractValue: z.int(), paidAmount: z.int(), debt: z.int() })
  .meta({ id: "ContractTotals" });

export const contractPageSchema = pageOf(contractSchema)
  .extend({ totals: contractTotalsSchema.nullable() })
  .meta({ id: "ContractPage" });

/** The package history tab (brief §5.3): what happened to the contract, newest first. */
export const contractHistorySchema = listOf(auditEventSchema).meta({ id: "ContractHistory" });

export type Contract = z.output<typeof contractSchema>;
export type ContractPage = z.output<typeof contractPageSchema>;
