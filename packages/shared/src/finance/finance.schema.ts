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
export const paymentInputSchema = z.object({
  amount: positiveAmount,
  /** From the "paymentMethods" option list (D-016, D-034). */
  methodId: optionChoice,
  methodNote: optionNote,
  paidOn: calendarDate,
});

export const cashTransactionInputSchema = z.object({
  branchId: branchChoice,
  type: z.enum(CASH_TRANSACTION_TYPES, { error: "invalidChoice" }),
  /** From "incomeCategories" or "expenseTypes", by type (D-016, D-034). */
  categoryId: optionChoice,
  categoryNote: optionNote,
  amount: positiveAmount,
  occurredOn: calendarDate,
  reference: text(100).transform(emptyToNull).prefault(""),
  description: text(500).transform(emptyToNull).prefault(""),
});

const optionalDate = z.union([z.literal(""), calendarDate]).optional().transform((value) => value || undefined);
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

export type PaymentInput = z.input<typeof paymentInputSchema>;
export type PaymentData = z.output<typeof paymentInputSchema>;
export type CashTransactionInput = z.input<typeof cashTransactionInputSchema>;
export type CashTransactionData = z.output<typeof cashTransactionInputSchema>;
