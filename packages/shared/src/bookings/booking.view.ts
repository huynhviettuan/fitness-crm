import { z } from "zod";
import { contractSchema } from "../contracts/contract.view.js";
import { customerRefSchema } from "../customers/customer.view.js";
import { employeeRefSchema } from "../employees/employee.view.js";
import { instant, listOf, pageOf } from "../validation/index.js";
import { BOOKING_STATUSES } from "./booking.domain.js";

export const bookingSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(BOOKING_STATUSES),
    scheduledStart: instant,
    scheduledEnd: instant,
    createdAt: instant,
    customer: customerRefSchema,
    contract: z.object({ id: z.uuid(), contractCode: z.string(), packageName: z.string(), remainingSessions: z.int() }),
    /** The employee who teaches the session (D-030). */
    trainer: employeeRefSchema,
    /** Fulfillment facts, from check-in on (T-011). */
    session: z
      .object({
        checkedInAt: instant,
        checkedInBy: z.string(),
        completedAt: instant.nullable(),
        completedBy: z.string().nullable(),
      })
      .nullable(),
  })
  .meta({ id: "Booking" });

export const bookingPageSchema = pageOf(bookingSchema).meta({ id: "BookingPage" });

/** One day of the PT calendar. */
export const bookingListSchema = listOf(bookingSchema).meta({ id: "BookingList" });

/** Completing a session returns the contract with its new remaining sessions (docs/08). */
export const sessionCompletionSchema = z
  .object({ booking: bookingSchema, contract: contractSchema })
  .meta({ id: "SessionCompletion" });

export type Booking = z.output<typeof bookingSchema>;
export type BookingPage = z.output<typeof bookingPageSchema>;
export type SessionCompletion = z.output<typeof sessionCompletionSchema>;
