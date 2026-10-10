import { z } from "zod";
import { contractSchema } from "../contracts/contract.view.js";
import { customerRefSchema } from "../customers/customer.view.js";
import { instant, pageOf } from "../validation/index.js";
import { CASH_TRANSACTION_TYPES, MONEY_RECORD_STATUSES, PAYMENT_METHODS } from "./finance.schema.js";

/** Who voided a record, when, and why (A-008, A-009). */
const voidFacts = {
  voidedAt: instant.nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.string().nullable(),
};

export const paymentSchema = z
  .object({
    id: z.uuid(),
    amount: z.int(),
    method: z.enum(PAYMENT_METHODS),
    /** The gym day the money was received (T-039). */
    paidOn: instant,
    status: z.enum(MONEY_RECORD_STATUSES),
    createdAt: instant,
    createdBy: z.string(),
    contract: z.object({ id: z.uuid(), contractCode: z.string(), packageName: z.string() }),
    customer: customerRefSchema,
    ...voidFacts,
  })
  .meta({ id: "Payment" });

export const paymentPageSchema = pageOf(paymentSchema).meta({ id: "PaymentPage" });

/** Confirmed payments received in a period (D-011: no opening balances). */
export const collectedSchema = z.object({ total: z.int() }).meta({ id: "Collected" });

/** Contracts that still owe money, largest debt first (BR-013, A-022). */
export const debtPageSchema = pageOf(contractSchema).meta({ id: "DebtPage" });

export const cashTransactionSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(CASH_TRANSACTION_TYPES),
    category: z.string(),
    amount: z.int(),
    description: z.string().nullable(),
    reference: z.string().nullable(),
    /** The gym day it happened (T-039). */
    occurredOn: instant,
    status: z.enum(MONEY_RECORD_STATUSES),
    createdAt: instant,
    createdBy: z.string(),
    ...voidFacts,
  })
  .meta({ id: "CashTransaction" });

export const cashTransactionPageSchema = pageOf(cashTransactionSchema).meta({ id: "CashTransactionPage" });

/**
 * Totals for a period (FR-CASH-002). Contract payments and other income stay separate
 * lines, with no net figure, until OQ-007 decides whether payments count as income.
 */
export const financeSummarySchema = z
  .object({ contractPayments: z.int(), otherIncome: z.int(), expense: z.int() })
  .meta({ id: "FinanceSummary" });

export type Payment = z.output<typeof paymentSchema>;
export type PaymentPage = z.output<typeof paymentPageSchema>;
export type CashTransaction = z.output<typeof cashTransactionSchema>;
export type CashTransactionPage = z.output<typeof cashTransactionPageSchema>;
export type FinanceSummary = z.output<typeof financeSummarySchema>;
