import { z } from "zod";
import { calendarDate, hasNoControlCharacters, timeOfDay } from "../validation/index.js";
import { WEEKDAYS } from "./class.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

const reference = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .pipe(z.uuid({ error: "invalidChoice" }));

/** A class: a weekly slot with a coach and a capacity (brief §6.4, A-160). */
export const classInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "required" })
      .max(100, { error: "tooLong" })
      .refine(hasNoControlCharacters, { error: "invalidCharacters" }),
    branchId: reference,
    coachId: reference,
    capacity: z.coerce
      .number({ error: "invalidNumber" })
      .int({ error: "invalidNumber" })
      .min(1, { error: "required" })
      .max(500),
    weekdays: z
      .array(
        z.coerce
          .number()
          .int()
          .refine((day) => (WEEKDAYS as readonly number[]).includes(day)),
      )
      .min(1, { error: "required" })
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    startTime: timeOfDay,
    endTime: timeOfDay,
  })
  .refine((data) => data.endTime > data.startTime, { path: ["endTime"], error: "endTimeNotAfterStart" });

/** The slot (days and times) is fixed once a class is made; the rest is edited (A-160). */
export const classUpdateSchema = z.object({
  name: classInputSchema.shape.name,
  coachId: reference,
  capacity: classInputSchema.shape.capacity,
  active: z.boolean({ error: "invalidChoice" }),
});

export const classSessionsQuerySchema = z.object({
  /** First gym day (dd/MM/yyyy). */
  date: calendarDate,
  /** 1 for the day view, 7 for the week view (A-161). */
  days: z.coerce.number().int().min(1).max(7).optional().default(1),
  branchId: z.uuid().optional(),
  coachId: z.uuid().optional(),
  classId: z.uuid().optional(),
});

/** Enrolling a customer on a group-class contract (BR-411). */
export const enrollSchema = z.object({ customerId: reference, contractId: reference });

/** Marking an enrolled customer present or absent (A-163). */
export const markAttendanceSchema = z.object({
  status: z.enum(["PRESENT", "ABSENT"], { error: "invalidChoice" }),
});

/** What the API takes: the capacity is a number, the weekdays are ISO numbers (the form converts its text). */
export type ClassInput = z.output<typeof classInputSchema>;
export type ClassUpdateInput = z.output<typeof classUpdateSchema>;
export type EnrollInput = z.input<typeof enrollSchema>;
export type MarkAttendanceInput = z.input<typeof markAttendanceSchema>;
