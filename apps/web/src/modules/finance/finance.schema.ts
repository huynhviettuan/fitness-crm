import { z } from "zod";
import { calendarDate } from "@/lib/validation/date";
import { vndAmount } from "@/lib/validation/money";
import { hasNoControlCharacters } from "@/lib/validation/text";

// Error messages are i18n keys under `validation.*` in messages/*.json.

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CARD", "E_WALLET"] as const;
export const CASH_TRANSACTION_TYPES = ["INCOME", "EXPENSE"] as const;
export const MONEY_RECORD_STATUSES = ["CONFIRMED", "VOIDED"] as const;

// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

/** BR-014: greater than zero. */
const positiveAmount = vndAmount.refine((amount) => amount > 0, { error: "amountNotPositive" });

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** Status, contract, and who recorded it are never accepted from the client. */
export const paymentInputSchema = z.object({
  amount: positiveAmount,
  method: z.enum(PAYMENT_METHODS, { error: "invalidChoice" }),
  paidOn: calendarDate,
});

export const cashTransactionInputSchema = z.object({
  type: z.enum(CASH_TRANSACTION_TYPES, { error: "invalidChoice" }),
  // Free text until the gym gives a list (OQ-016).
  category: text(100).pipe(z.string().min(1, { error: "required" })),
  amount: positiveAmount,
  occurredOn: calendarDate,
  reference: text(100).transform(emptyToNull).prefault(""),
  description: text(500).transform(emptyToNull).prefault(""),
});

/** A-008, A-009: voiding requires a reason. */
export const voidSchema = z.object({
  reason: text(500).pipe(z.string().min(1, { error: "required" })),
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
  status: z.enum(MONEY_RECORD_STATUSES).optional(),
  contractId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  ...paging,
});

export const listCashTransactionsSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  type: z.enum(CASH_TRANSACTION_TYPES).optional(),
  status: z.enum(MONEY_RECORD_STATUSES).optional(),
  ...paging,
});

export const periodSchema = z.object({ from: calendarDate, to: calendarDate });

export const debtListSchema = z.object(paging);

export type PaymentInput = z.input<typeof paymentInputSchema>;
export type PaymentData = z.output<typeof paymentInputSchema>;
export type CashTransactionInput = z.input<typeof cashTransactionInputSchema>;
export type CashTransactionData = z.output<typeof cashTransactionInputSchema>;
export type VoidInput = z.input<typeof voidSchema>;
