import { z } from "zod";
import { calendarDate, hasNoControlCharacters, vndAmount } from "../validation/index.js";
import { VOUCHER_KINDS, VOUCHER_STATUSES } from "./change.domain.js";

// Contract change vouchers (M8, brief §5.6): inputs. Error messages are i18n keys under `validation.*`.

const blank = (value: unknown) => (value === "" ? undefined : value);
const emptyToNull = (value: string) => (value === "" ? null : value);
const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });
const note = text(500).transform(emptyToNull).nullable().prefault("");
const optionalDay = z.preprocess(blank, calendarDate.optional());
const count = (max: number) =>
  z.coerce
    .number({ error: "invalidNumber" })
    .int({ error: "invalidNumber" })
    .min(0, { error: "outOfRange" })
    .max(max, { error: "outOfRange" })
    .prefault(0);

/** A renewal adds months, days or sessions, and the amount to pay for them (brief §5.6). */
export const renewalInputSchema = z
  .object({
    contractId: z.uuid({ error: "required" }),
    /** The first day of the new period; the day after the contract ends when empty. */
    fromDate: optionalDay,
    months: count(120),
    days: count(3650),
    sessions: count(1000),
    amount: z.preprocess((value) => (value === "" ? 0 : value), vndAmount).prefault(0),
    note,
  })
  .refine((value) => value.months + value.days + value.sessions > 0, { path: ["sessions"], error: "nothingToAdd" });

/** A hold stops the contract at the customer's request for some days, which are added to its end (brief §5.6). */
export const holdInputSchema = z
  .object({
    contractId: z.uuid({ error: "required" }),
    fromDate: calendarDate,
    toDate: calendarDate,
    note,
  })
  .refine(
    (value) =>
      !(value.fromDate instanceof Date && value.toDate instanceof Date) ||
      value.toDate.getTime() >= value.fromDate.getTime(),
    {
      path: ["toDate"],
      error: "endBeforeStart",
    },
  );

const money = z.preprocess((value) => (value === "" ? 0 : value), vndAmount).prefault(0);

/**
 * An upgrade or a conversion exchanges what is left of the package for a new one (brief §5.6, A-227): the new service, its
 * sessions and its price, and the value credited for the sessions left. The credit cannot be more than the price: giving money
 * back is a cancellation.
 */
export const exchangeInputSchema = z
  .object({
    contractId: z.uuid({ error: "required" }),
    targetServiceId: z.uuid({ error: "required" }),
    sessions: z.coerce
      .number({ error: "invalidNumber" })
      .int({ error: "invalidNumber" })
      .min(1, { error: "outOfRange" })
      .max(1000, { error: "outOfRange" }),
    amount: money,
    credit: money,
    note,
  })
  .refine((value) => value.credit <= value.amount, { path: ["credit"], error: "creditAboveAmount" });

/**
 * A transfer gives the sessions left to another customer (brief §5.6, A-232): who gets them and the value that goes with
 * them, which becomes the receiver's paid amount.
 */
export const transferInputSchema = z.object({
  contractId: z.uuid({ error: "required" }),
  toCustomerId: z.uuid({ error: "required" }),
  credit: money,
  note,
});

/** A branch transfer moves the contract to another branch for a fee that is added to what is owed (A-235). */
export const branchTransferInputSchema = z.object({
  contractId: z.uuid({ error: "required" }),
  toBranchId: z.uuid({ error: "required" }),
  fee: money,
  note,
});

export const voucherListQuerySchema = z.object({
  contractId: z.preprocess(blank, z.uuid({ error: "invalidChoice" }).optional()),
  customerId: z.preprocess(blank, z.uuid({ error: "invalidChoice" }).optional()),
  kind: z.preprocess(blank, z.enum(VOUCHER_KINDS, { error: "invalidChoice" }).optional()),
  status: z.preprocess(blank, z.enum(VOUCHER_STATUSES, { error: "invalidChoice" }).optional()),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type RenewalInput = z.input<typeof renewalInputSchema>;
export type ExchangeInput = z.input<typeof exchangeInputSchema>;
export type TransferInput = z.input<typeof transferInputSchema>;
export type BranchTransferInput = z.input<typeof branchTransferInputSchema>;
export type HoldInput = z.input<typeof holdInputSchema>;
