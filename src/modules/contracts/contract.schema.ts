import { z } from "zod";
import { calendarDate } from "@/lib/validation/date";
import { vndAmount } from "@/lib/validation/money";
import { hasNoControlCharacters } from "@/lib/validation/text";

// Error messages are i18n keys under `validation.*` in messages/*.json.
const packageName = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(150, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });

const totalSessions = z.coerce
  .number({ error: "invalidNumber" })
  .int({ error: "invalidNumber" })
  .min(1, { error: "invalidNumber" })
  .max(1000, { error: "invalidNumber" });

/**
 * The fields staff enter. Contract code, status, and opening balances are never
 * accepted from the client (BR-001, D-011).
 */
export const contractInputSchema = z
  .object({ packageName, contractValue: vndAmount, totalSessions, startDate: calendarDate, endDate: calendarDate })
  .refine((data) => data.endDate.getTime() >= data.startDate.getTime(), {
    path: ["endDate"],
    error: "endBeforeStart",
  });

/** T-015: a client-generated UUID sent with every create. */
export const idempotencyKeySchema = z.uuid();

export const listContractsSchema = z.object({
  q: z.string().trim().max(100).refine(hasNoControlCharacters).optional().default(""),
  customerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ContractInput = z.input<typeof contractInputSchema>;
export type ContractData = z.output<typeof contractInputSchema>;
