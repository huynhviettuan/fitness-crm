import { z } from "zod";
import { formatReminderHours, parseReminderHours } from "../tasks/reminder.domain.js";
import { timeOfDay } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/**
 * System parameters (T-049): values the flows read and admin changes on screen. The
 * keys are code; the values live in the database. Defaults are the brief's initial
 * values and apply until admin saves another value. Parameters are added with the
 * features that read them.
 */
export const PARAMETER_DEFAULTS = {
  /** First and last time on the PT calendar (D-030). */
  calendarDayStart: "05:00",
  calendarDayEnd: "22:00",
  /** Prefixes of generated codes (D-038); the number after them never repeats. */
  leadCodePrefix: "LD",
  customerCodePrefix: "KH",
  contractCodePrefix: "HD",
  /** Receipts (phiếu thu) and expense vouchers (phiếu chi), M4.5. */
  receiptCodePrefix: "PT",
  expenseCodePrefix: "PC",
  employeeCodePrefix: "NV",
  /** The shared reminder points of a task, hours before its deadline: 24, 3, and 1 (brief §8.2, D-056). */
  taskReminderHours: "24, 3, 1",
  /** Days after No response, Refused, or No show before the lead is contacted again (BR-204, OQ-018). */
  recareDays: "15",
  /** A customer whose last active contract ends within this many days is "expiring soon" (D-040, M4.5). */
  expiringSoonDays: "30",
  /** A session cannot be cancelled (Hủy lịch) closer to its start than this many hours; 0 switches the limit off (D-029, BR-410). */
  cancelCutoffHours: "0",
  /** Minutes a scan waits for the other side of its pair (D-070). */
  scanPairWaitMinutes: "15",
  /** A pair counts for a booked session from this many minutes before its start to this many after its end (D-070). */
  scanWindowMinutes: "60",
  /** A second scan of the same person within this many seconds counts once (D-070). */
  scanRepeatSeconds: "10",
  /** A machine whose clock differs from the server by more than this many seconds raises a warning (D-072). */
  scanClockToleranceSeconds: "120",
  /** A session still hanging after this many hours is reported to the Studio Manager with a task (D-071). */
  hangingEscalationHours: "24",
  /** How many weeks ahead the sessions of a class are generated (A-161, M5.5). */
  classGenerateWeeks: "8",
  /** A running contract with this many sessions left or fewer is "running out" in the contract report (A-023, M4.7). */
  runningOutSessions: "3",
  /** The department whose task Báo Studio creates or updates (brief §4.1, OQ-032); "" for none yet. */
  studioDepartmentId: "",
  /** The department whose task an email that could not be sent creates (FR-MAIL-003); "" for none yet. */
  receptionDepartmentId: "",
  /** A contract deactivated for more than this many days reminds the manager (D-023, M4.6). */
  freezeReminderDays: "10",
  /** The department whose task that reminder creates; "" for none yet. */
  managerDepartmentId: "",
  /** The most rows one Excel export holds; a longer list must be narrowed first (A-078). */
  exportRowLimit: "50000",
  /** Working minutes an untouched lead waits before it moves to the next consultant; 0 switches it off (D-052). */
  reclaimMinutes: "60",
  /** The consultants' working window of the gym's day: the reclaim clock runs only inside it (D-052). */
  consultingWindowStart: "08:30",
  consultingWindowEnd: "20:30",
  /** Minutes after its deadline a consulting step can still be ticked, as "Trễ"; then it locks as "Không thực hiện" (D-054). */
  stepGraceMinutes: "120",
} as const;

export type ParameterKey = keyof typeof PARAMETER_DEFAULTS;
export const PARAMETER_KEYS = Object.keys(PARAMETER_DEFAULTS) as ParameterKey[];

/** The calendar is drawn in 30-minute cells (D-030), so its hours fall on them. */
const calendarTime = timeOfDay.refine((value) => value.endsWith(":00") || value.endsWith(":30"), {
  error: "notOnHalfHour",
});

const codePrefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,5}$/, { error: "invalidCodePrefix" });

/** The reminder points of a task: hours before the deadline, "24, 3, 1"; at least one, kept in this form (D-056). */
const reminderHours = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parseReminderHours(value);
    if ("error" in parsed || parsed.minutes.length === 0) {
      ctx.addIssue({ code: "custom", message: "error" in parsed ? parsed.error : "invalidReminders" });
      return z.NEVER;
    }
    return formatReminderHours(parsed.minutes);
  });

/** Whole days, 1 to 365. */
const days = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) >= 1 && Number(value) <= 365, { error: "daysOutOfRange" })
  .transform((value) => String(Number(value)));

/** Whole rows, 100 to 200,000. */
const rows = z
  .string()
  .trim()
  .regex(/^\d{1,6}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) >= 100 && Number(value) <= 200_000, { error: "rowsOutOfRange" })
  .transform((value) => String(Number(value)));

/** Whole minutes, 0 to 1440 (a day); 0 is off. */
const minutes = z
  .string()
  .trim()
  .regex(/^\d{1,4}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) <= 1440, { error: "minutesOutOfRange" })
  .transform((value) => String(Number(value)));

/** Whole seconds, 1 to 3600. */
const seconds = z
  .string()
  .trim()
  .regex(/^\d{1,4}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) >= 1 && Number(value) <= 3600, { error: "secondsOutOfRange" })
  .transform((value) => String(Number(value)));

/** Whole weeks, 1 to 26. */
const weeks = z
  .string()
  .trim()
  .regex(/^\d{1,2}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) >= 1 && Number(value) <= 26, { error: "weeksOutOfRange" })
  .transform((value) => String(Number(value)));

/** Whole hours, 0 to 720; 0 switches the limit off. */
const hours = z
  .string()
  .trim()
  .regex(/^\d{1,3}$/, { error: "invalidNumber" })
  .refine((value) => Number(value) <= 720, { error: "hoursOutOfRange" })
  .transform((value) => String(Number(value)));

export const parametersInputSchema = z
  .object({
    calendarDayStart: calendarTime,
    calendarDayEnd: calendarTime,
    leadCodePrefix: codePrefix,
    customerCodePrefix: codePrefix,
    contractCodePrefix: codePrefix,
    receiptCodePrefix: codePrefix,
    expenseCodePrefix: codePrefix,
    employeeCodePrefix: codePrefix,
    taskReminderHours: reminderHours,
    recareDays: days,
    expiringSoonDays: days,
    cancelCutoffHours: hours,
    scanPairWaitMinutes: minutes,
    scanWindowMinutes: minutes,
    scanRepeatSeconds: seconds,
    scanClockToleranceSeconds: seconds,
    hangingEscalationHours: hours,
    classGenerateWeeks: weeks,
    runningOutSessions: days,
    studioDepartmentId: z.union([z.literal(""), z.uuid({ error: "invalidChoice" })]),
    receptionDepartmentId: z.union([z.literal(""), z.uuid({ error: "invalidChoice" })]),
    freezeReminderDays: days,
    managerDepartmentId: z.union([z.literal(""), z.uuid({ error: "invalidChoice" })]),
    exportRowLimit: rows,
    reclaimMinutes: minutes,
    consultingWindowStart: timeOfDay,
    consultingWindowEnd: timeOfDay,
    stepGraceMinutes: minutes,
  })
  .refine((value) => value.calendarDayEnd > value.calendarDayStart, {
    path: ["calendarDayEnd"],
    error: "endTimeNotAfterStart",
  })
  .refine((value) => value.consultingWindowEnd > value.consultingWindowStart, {
    path: ["consultingWindowEnd"],
    error: "endTimeNotAfterStart",
  });

export const parametersSchema = z
  .object({
    calendarDayStart: z.string(),
    calendarDayEnd: z.string(),
    leadCodePrefix: z.string(),
    customerCodePrefix: z.string(),
    contractCodePrefix: z.string(),
    receiptCodePrefix: z.string(),
    expenseCodePrefix: z.string(),
    employeeCodePrefix: z.string(),
    taskReminderHours: z.string(),
    recareDays: z.string(),
    expiringSoonDays: z.string(),
    cancelCutoffHours: z.string(),
    scanPairWaitMinutes: z.string(),
    scanWindowMinutes: z.string(),
    scanRepeatSeconds: z.string(),
    scanClockToleranceSeconds: z.string(),
    hangingEscalationHours: z.string(),
    classGenerateWeeks: z.string(),
    runningOutSessions: z.string(),
    studioDepartmentId: z.string(),
    receptionDepartmentId: z.string(),
    freezeReminderDays: z.string(),
    managerDepartmentId: z.string(),
    exportRowLimit: z.string(),
    reclaimMinutes: z.string(),
    consultingWindowStart: z.string(),
    consultingWindowEnd: z.string(),
    stepGraceMinutes: z.string(),
  })
  .meta({ id: "Parameters" });

export type ParametersInput = z.input<typeof parametersInputSchema>;
export type Parameters = z.output<typeof parametersSchema>;

/** "05:30" → 330. */
export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** A generated code: the prefix and at least `digits` digits (D-038), e.g. KH000123. */
export function formatCode(prefix: string, sequenceValue: bigint | number, digits: number): string {
  return `${prefix}${sequenceValue.toString().padStart(digits, "0")}`;
}
