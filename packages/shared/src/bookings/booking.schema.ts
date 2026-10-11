import { z } from "zod";
import { calendarDate, timeOfDay } from "../validation/index.js";
import { BOOKING_STATUSES } from "./booking.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/** A record chosen from a list; the form sends "" when nothing is chosen. */
const reference = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .pipe(z.uuid({ error: "invalidChoice" }));

/**
 * One booking slot, as staff type it: a day and wall-clock times in the gym timezone.
 * A booking starts and ends on the same day, and ends after it starts (BR-011).
 */
const slot = { date: calendarDate, startTime: timeOfDay, endTime: timeOfDay };
const endsAfterStart = (data: { startTime: string; endTime: string }) => data.endTime > data.startTime;
const endTimeError = { path: ["endTime"], error: "endTimeNotAfterStart" };

/** Status, codes, and session facts are never accepted from the client. */
export const bookingInputSchema = z
  .object({ customerId: reference, contractId: reference, trainerId: reference, ...slot })
  .refine(endsAfterStart, endTimeError);

/** Reschedule: a new trainer and time. The customer and contract never change. */
export const rescheduleSchema = z.object({ trainerId: reference, ...slot }).refine(endsAfterStart, endTimeError);

const optionalDate = z
  .union([z.literal(""), calendarDate])
  .optional()
  .transform((value) => value || undefined);

export const listBookingsSchema = z.object({
  /** First and last gym day, inclusive (dd/MM/yyyy). */
  from: optionalDate,
  to: optionalDate,
  status: z.enum(BOOKING_STATUSES).optional(),
  trainerId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  /** By scheduled start. */
  order: z.enum(["asc", "desc"]).optional().default("asc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const dayBookingsSchema = z.object({
  date: calendarDate,
  trainerId: z.uuid().optional(),
});

export type BookingInput = z.input<typeof bookingInputSchema>;
export type BookingData = z.output<typeof bookingInputSchema>;
export type RescheduleInput = z.input<typeof rescheduleSchema>;
export type RescheduleData = z.output<typeof rescheduleSchema>;
