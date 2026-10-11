import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { optionNote } from "../options/option.schema.js";
import { formatCode } from "../parameters/parameter.schema.js";
import { calendarDate, hasNoControlCharacters, normalizePhone, parseDateOnly } from "../validation/index.js";
import { minutesOfTime, overlappingShift } from "./employee.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

/** Working status (brief §8.4). An employee who left keeps their history but takes no bookings. */
export const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export type Gender = (typeof GENDERS)[number];

/** D-038: the configured prefix + at least 3 digits, e.g. NV001. */
export function formatEmployeeCode(prefix: string, sequenceValue: bigint | number): string {
  return formatCode(prefix, sequenceValue, 3);
}

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

const fullName = text(150).pipe(z.string().min(1, { error: "required" }));

const phone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.union([z.literal(""), z.string().regex(/^\+?\d{8,15}$/, { error: "invalidPhone" })]))
  .transform(emptyToNull);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(""), z.email({ error: "invalidEmail" })]))
  .transform(emptyToNull);

// dd/MM/yyyy, not in the future.
const birthDate = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const date = parseDateOnly(value);
    if (!date || date.getTime() > Date.now()) {
      ctx.addIssue({ code: "custom", message: "invalidDate" });
      return z.NEVER;
    }
    return date;
  });

/** An optional field from an option list (D-016): "" or null for none. */
const optionalChoice = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "invalidChoice" }).nullable(),
);

/** The linked login (brief §8.4). The form sends "" for "no login". */
const userId = z.preprocess((value) => (value === "" ? null : value), z.uuid({ error: "invalidChoice" }).nullable());

/** Create and update take the same fields; the employee code is never accepted (T-019). */
export const employeeInputSchema = z.object({
  /** The branch the employee works at (D-014); kept when left out on an update. */
  branchId: branchChoice,
  fullName,
  birthDate: birthDate.prefault(""),
  gender: z
    .preprocess((value) => (value === "" ? null : value), z.enum(GENDERS, { error: "invalidChoice" }).nullable())
    .prefault(""),
  phone: phone.prefault(""),
  email: email.prefault(""),
  /** From the "departments" list (OQ-024 interim); "Khác" needs a note. */
  departmentId: optionalChoice.prefault(""),
  departmentNote: optionNote,
  team: text(100).transform(emptyToNull).prefault(""),
  /** From the "jobTitles" list; "Khác" needs a note. */
  titleId: optionalChoice.prefault(""),
  titleNote: optionNote,
  status: z.enum(EMPLOYEE_STATUSES, { error: "invalidChoice" }).prefault("ACTIVE"),
  /** Teaches PT: appears on the PT calendar and can be booked (D-030). */
  isTrainer: z.boolean({ error: "invalidChoice" }).prefault(false),
  userId: userId.prefault(""),
});

/** Query flags arrive as strings. */
const flag = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true")
  .prefault(false);

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const listEmployeesSchema = z.object({
  q: text(100).prefault(""),
  status: optional(z.enum(EMPLOYEE_STATUSES, { error: "invalidChoice" })),
  departmentId: optional(z.uuid({ error: "invalidChoice" })),
  /** Only employees who teach PT. */
  trainersOnly: flag,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ---------------------------------------------------------------- working schedule

/** ISO weekdays: 1 is Monday, 7 is Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Shifts follow the calendar's 30-minute cells (D-030); a shift may end at 24:00. */
const shiftTime = z
  .string()
  .trim()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, { error: "invalidTime" })
  .refine((value) => value.endsWith(":00") || value.endsWith(":30"), { error: "notOnHalfHour" });

export const shiftSchema = z
  .object({
    weekday: z.int({ error: "invalidChoice" }).min(1, { error: "invalidChoice" }).max(7, { error: "invalidChoice" }),
    start: shiftTime.refine((value) => value !== "24:00", { error: "invalidTime" }),
    end: shiftTime,
  })
  .refine((shift) => minutesOfTime(shift.end) > minutesOfTime(shift.start), {
    path: ["end"],
    error: "endTimeNotAfterStart",
  });

/** The whole weekly pattern, replacing the one before. Shifts of one day do not overlap. */
export const shiftsInputSchema = z
  .object({ shifts: z.array(shiftSchema).max(70, { error: "tooLong" }) })
  .superRefine((value, ctx) => {
    const clash = overlappingShift(value.shifts);
    if (clash >= 0) ctx.addIssue({ code: "custom", path: ["shifts", clash, "start"], message: "shiftsOverlap" });
  });

/** A day the employee does not work, whatever the weekly pattern says. */
export const dayOffInputSchema = z.object({
  date: calendarDate,
  note: text(200).transform(emptyToNull).prefault(""),
});

/** The PT calendar's trainers for one day: their working hours (D-030). */
export const trainersOfDaySchema = z.object({ date: calendarDate });

export type EmployeeInput = z.input<typeof employeeInputSchema>;
export type EmployeeData = z.output<typeof employeeInputSchema>;
export type ShiftInput = z.input<typeof shiftSchema>;
export type ShiftsInput = z.input<typeof shiftsInputSchema>;
export type DayOffInput = z.input<typeof dayOffInputSchema>;
