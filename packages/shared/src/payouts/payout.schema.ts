import { z } from "zod";
import { optionChoice, optionNote } from "../options/option.schema.js";
import { calendarDate } from "../validation/index.js";

// PT payouts (M5.7, FR-CASH-003): inputs. Error messages are i18n keys under `validation.*`.

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/**
 * Pays a PT the sessions of a period of the allocation report that are not paid yet, and takes back the paid sessions
 * deleted since. The voucher's category and method are chosen from the option lists (D-016); the amount is never typed.
 */
export const ptPayoutInputSchema = z.object({
  trainerId: z.uuid({ error: "invalidChoice" }),
  from: calendarDate,
  to: calendarDate,
  /** From the "expenseTypes" list. */
  categoryId: optionChoice,
  categoryNote: optionNote,
  /** From the "paymentMethods" list. */
  methodId: optionChoice,
  methodNote: optionNote,
});

export const ptPayoutListQuerySchema = z.object({
  trainerId: optional(z.uuid({ error: "invalidChoice" })),
  from: optional(calendarDate),
  to: optional(calendarDate),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type PtPayoutInput = z.input<typeof ptPayoutInputSchema>;
export type PtPayoutData = z.output<typeof ptPayoutInputSchema>;
