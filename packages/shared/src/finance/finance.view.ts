import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { contractSchema } from "../contracts/contract.view.js";
import { customerRefSchema } from "../customers/customer.view.js";
import { instant, pageOf } from "../validation/index.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { CASH_TRANSACTION_TYPES } from "./finance.schema.js";
import { RECORD_APPROVAL_STATUSES } from "../approvals/approval.schema.js";

export const paymentSchema = z
  .object({
    id: z.uuid(),
    /** The receipt number (D-034), e.g. PT000012; never reused. */
    receiptNumber: z.string(),
    amount: z.int(),
    method: chosenOptionSchema,
    /** The salesperson the receipt is credited to. */
    saleEmployee: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }).nullable(),
    note: z.string().nullable(),
    /** The transfer proof picture (M4.1b, A-144): fetched through a signed link, `GET /files/{id}/link`. */
    proofFileId: z.uuid().nullable(),
    /** The gym day the money was received (T-039). */
    paidOn: instant,
    /** Counts toward the paid amount only when APPROVED (D-018, D-034). */
    approvalStatus: z.enum(RECORD_APPROVAL_STATUSES),
    createdAt: instant,
    /** The collector: who recorded the receipt. */
    createdBy: z.string(),
    contract: z.object({ id: z.uuid(), contractCode: z.string(), packageName: z.string() }),
    customer: customerRefSchema,
  })
  .meta({ id: "Payment" });

export const paymentPageSchema = pageOf(paymentSchema).meta({ id: "PaymentPage" });

/**
 * Payments received in a period, deleted ones left out (D-011: no opening balances). Null when the
 * role has receipt totals hidden (D-017).
 */
export const collectedSchema = z.object({ total: z.int().nullable() }).meta({ id: "Collected" });

/** Contracts that still owe money, largest debt first (BR-013, A-022). */
export const debtPageSchema = pageOf(contractSchema).meta({ id: "DebtPage" });

export const cashTransactionSchema = z
  .object({
    id: z.uuid(),
    /** PT… for a receipt without a contract, PC… for an expense voucher (D-034). */
    number: z.string(),
    branch: branchRefSchema,
    type: z.enum(CASH_TRANSACTION_TYPES),
    category: chosenOptionSchema,
    method: chosenOptionSchema,
    /** Who an expense voucher is paid to. */
    payee: z.string().nullable(),
    /** The contract a refund belongs to. */
    contract: z.object({ id: z.uuid(), contractCode: z.string() }).nullable(),
    amount: z.int(),
    description: z.string().nullable(),
    reference: z.string().nullable(),
    /** The gym day it happened (T-039). */
    occurredOn: instant,
    /** Counts toward the totals only when APPROVED (D-018, D-034). */
    approvalStatus: z.enum(RECORD_APPROVAL_STATUSES),
    createdAt: instant,
    /** The payer (expense) or collector (income): who recorded it. */
    createdBy: z.string(),
  })
  .meta({ id: "CashTransaction" });

export const cashTransactionPageSchema = pageOf(cashTransactionSchema).meta({ id: "CashTransactionPage" });

/**
 * Totals for a period (FR-CASH-002). Contract payments and other income stay separate
 * lines, with no net figure, until OQ-007 decides whether payments count as income.
 * Each is null when the role has receipt totals hidden (D-017).
 */
export const financeSummarySchema = z
  .object({ contractPayments: z.int().nullable(), otherIncome: z.int().nullable(), expense: z.int().nullable() })
  .meta({ id: "FinanceSummary" });

export type Payment = z.output<typeof paymentSchema>;
export type PaymentPage = z.output<typeof paymentPageSchema>;
export type CashTransaction = z.output<typeof cashTransactionSchema>;
export type CashTransactionPage = z.output<typeof cashTransactionPageSchema>;
export type FinanceSummary = z.output<typeof financeSummarySchema>;
