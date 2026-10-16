import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { optionChoice, optionNote } from "../options/option.schema.js";
import { calendarDate, vndAmount, hasNoControlCharacters } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

export const CASH_TRANSACTION_TYPES = ["INCOME", "EXPENSE"] as const;

// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

/** BR-014: greater than zero. */
const positiveAmount = vndAmount.refine((amount) => amount > 0, { error: "amountNotPositive" });

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** Status, contract, and who recorded it are never accepted from the client. */
const optionalUuid = z
  .union([z.literal(""), z.null(), z.uuid({ error: "invalidChoice" })])
  .transform((value) => (value === "" ? null : value));

export const paymentInputSchema = z.object({
  amount: positiveAmount,
  /** The salesperson the receipt is credited to, an employee of the contract's branch (brief §8.1). */
  saleEmployeeId: optionalUuid.prefault(""),
  note: text(500).transform(emptyToNull).prefault(""),
  /** From the "paymentMethods" option list (D-016, D-034). */
  methodId: optionChoice,
  methodNote: optionNote,
  paidOn: calendarDate,
});

/** Editing a receipt's date: a permission of its own, always logged (D-034). */
export const receiptDateSchema = z.object({ paidOn: calendarDate });

export const cashTransactionInputSchema = z
  .object({
    branchId: branchChoice,
    type: z.enum(CASH_TRANSACTION_TYPES, { error: "invalidChoice" }),
    /** From the "paymentMethods" list (D-016, D-034). */
    methodId: optionChoice,
    methodNote: optionNote,
    /** Who an expense voucher is paid to. */
    payee: text(100).transform(emptyToNull).prefault(""),
    /** A refund on cancellation is linked to the contract (D-034). */
    contractId: optionalUuid.prefault(""),
    /** From "incomeCategories" or "expenseTypes", by type (D-016, D-034). */
    categoryId: optionChoice,
    categoryNote: optionNote,
    amount: positiveAmount,
    occurredOn: calendarDate,
    reference: text(100).transform(emptyToNull).prefault(""),
    description: text(500).transform(emptyToNull).prefault(""),
  })
  .superRefine((value, ctx) => {
    if (value.type === "EXPENSE" && value.payee === null) {
      ctx.addIssue({ code: "custom", path: ["payee"], message: "required" });
    }
    if (value.type === "INCOME" && (value.payee !== null || value.contractId !== null)) {
      ctx.addIssue({ code: "custom", path: [value.payee !== null ? "payee" : "contractId"], message: "expenseOnly" });
    }
  });

const optionalDate = z
  .union([z.literal(""), calendarDate])
  .optional()
  .transform((value) => value || undefined);
const paging = {
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
};

export const listPaymentsSchema = z.object({
  /** First and last gym day, inclusive (dd/MM/yyyy). */
  from: optionalDate,
  to: optionalDate,
  contractId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  ...paging,
});

export const listCashTransactionsSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  type: z.enum(CASH_TRANSACTION_TYPES).optional(),
  ...paging,
});

export const periodSchema = z.object({ from: calendarDate, to: calendarDate });

export const debtListSchema = z.object(paging);

export type ReceiptDateInput = z.input<typeof receiptDateSchema>;
export type PaymentInput = z.input<typeof paymentInputSchema>;
export type PaymentData = z.output<typeof paymentInputSchema>;
export type CashTransactionInput = z.input<typeof cashTransactionInputSchema>;
export type CashTransactionData = z.output<typeof cashTransactionInputSchema>;
