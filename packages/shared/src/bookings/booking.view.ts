import { z } from "zod";
import { contractSchema } from "../contracts/contract.view.js";
import { customerRefSchema } from "../customers/customer.view.js";
import { employeeRefSchema } from "../employees/employee.view.js";
import { instant, listOf, pageOf } from "../validation/index.js";
import { STATUS_COLORS } from "./booking.domain.js";

/** A session status and its rule (brief §6.2, D-025): what admin configures. */
export const sessionStatusSchema = z
  .object({
    code: z.string(),
    labelVi: z.string(),
    labelEn: z.string(),
    /** Uses one of the contract's sessions. */
    consumes: z.boolean(),
    /** Credits the PT with the session. */
    creditsPt: z.boolean(),
    /** Still holds the trainer's time slot. */
    holdsSlot: z.boolean(),
    /** Cannot be changed once set. */
    locksOnSet: z.boolean(),
    color: z.enum(STATUS_COLORS),
    sortOrder: z.int(),
  })
  .meta({ id: "SessionStatus" });

export const sessionStatusListSchema = listOf(sessionStatusSchema).meta({ id: "SessionStatusList" });

export const bookingSchema = z
  .object({
    id: z.uuid(),
    /** The code of the booking's status, a key of the session statuses. */
    status: z.string(),
    /** The status as configured now: its labels and color. */
    statusRule: z.object({
      labelVi: z.string(),
      labelEn: z.string(),
      color: z.enum(STATUS_COLORS),
      locksOnSet: z.boolean(),
    }),
    /** The rule applied when the status was set, kept so a later change of the rule never rewrites it (T-050). */
    consumes: z.boolean(),
    creditsPt: z.boolean(),
    holdsSlot: z.boolean(),
    /** Burn Show: a trained session added by hand (D-028). */
    addedByHand: z.boolean(),
    /** The customer checked in: a session record exists. */
    checkedIn: z.boolean(),
    scheduledStart: instant,
    scheduledEnd: instant,
    createdAt: instant,
    customer: customerRefSchema,
    contract: z.object({
      id: z.uuid(),
      contractCode: z.string(),
      packageName: z.string(),
      remainingSessions: z.int(),
      /** A booked session of a deactivated contract is highlighted for admin to deal with (D-023). */
      frozen: z.boolean(),
    }),
    /** The employee who teaches the session (D-030). */
    trainer: employeeRefSchema,
    /** Fulfillment facts, from check-in on (T-011). */
    session: z
      .object({
        checkedInAt: instant,
        /** Null when a paired device scan confirmed the session (M5.3b). */
        checkedInBy: z.string().nullable(),
        completedAt: instant.nullable(),
        completedBy: z.string().nullable(),
        /** How the session was confirmed: by hand, or by a paired device scan (D-069). */
        confirmationMethod: z.enum(["MANUAL", "DEVICE"]),
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

/** Bulk "Đã tập": one result per session, so a refused one does not hide the others. */
export const completeDayResultSchema = z
  .object({
    completed: z.int(),
    items: z.array(z.object({ bookingId: z.uuid(), ok: z.boolean(), code: z.string().nullable() })),
  })
  .meta({ id: "CompleteDayResult" });

export type CompleteDayResult = z.output<typeof completeDayResultSchema>;
export type Booking = z.output<typeof bookingSchema>;
export type SessionStatus = z.output<typeof sessionStatusSchema>;
export type BookingPage = z.output<typeof bookingPageSchema>;
export type SessionCompletion = z.output<typeof sessionCompletionSchema>;
