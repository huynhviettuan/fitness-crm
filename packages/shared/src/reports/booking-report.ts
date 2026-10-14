import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { periodReportQuerySchema } from "../finance/cash-book.js";
import { STATUS_COLORS } from "../bookings/booking.domain.js";
import { instant, pageOf } from "../validation/index.js";

// The booking report (brief §9, D-041; A-171): the PT sessions of a period, one row each.

/** A booked PT session, or a Burn Show added by hand (D-028). */
export const BOOKING_REPORT_TYPES = ["PT", "BURN_SHOW"] as const;
export type BookingReportType = (typeof BOOKING_REPORT_TYPES)[number];

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const bookingReportQuerySchema = periodReportQuerySchema.extend({
  trainerId: optional(z.uuid({ error: "invalidChoice" })),
  type: optional(z.enum(BOOKING_REPORT_TYPES, { error: "invalidChoice" })),
  /** A key of the session statuses. */
  status: optional(z.string().trim().max(40, { error: "tooLong" })),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type BookingReportQuery = z.input<typeof bookingReportQuerySchema>;

export const bookingReportRowSchema = z.object({
  id: z.uuid(),
  type: z.enum(BOOKING_REPORT_TYPES),
  customer: z.object({
    id: z.uuid(),
    customerCode: z.string(),
    fullName: z.string(),
    /** Empty when the role has phones hidden (D-017). */
    phone: z.string().nullable(),
  }),
  contract: z.object({ id: z.uuid(), contractCode: z.string() }),
  branch: branchRefSchema,
  /** The PT who teaches the session. */
  staff: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }),
  status: z.object({
    code: z.string(),
    labelVi: z.string(),
    labelEn: z.string(),
    color: z.enum(STATUS_COLORS),
  }),
  scheduledStart: instant,
  scheduledEnd: instant,
  /** When the customer checked in, and when the session was completed (checked out). */
  checkedInAt: instant.nullable(),
  checkedOutAt: instant.nullable(),
  createdAt: instant,
});

export const bookingReportPageSchema = pageOf(bookingReportRowSchema).meta({ id: "BookingReportPage" });

export type BookingReportRow = z.output<typeof bookingReportRowSchema>;
export type BookingReportPage = z.output<typeof bookingReportPageSchema>;
