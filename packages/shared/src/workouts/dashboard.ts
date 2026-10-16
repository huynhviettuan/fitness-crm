import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { calendarDate, instant, pageOf } from "../validation/index.js";

// The weekly workout dashboard (M7.5, brief §9, FR-WKO-005, AC-21; A-212 to A-217): over every customer, the share of each
// Flag and each Action among the sets recorded in the week, the customers with a Flag other than Normal, the comparison
// with the week before, and the escalations still waiting. A share opens the list of sets behind it.

const DAY = 86_400_000;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** The Monday and the Sunday of the week a day falls in (a week runs Monday to Sunday, as in Vietnam). */
export function weekOf(day: Date): { from: Date; to: Date } {
  const weekday = (day.getUTCDay() + 6) % 7;
  const from = new Date(day.getTime() - weekday * DAY);
  return { from, to: new Date(from.getTime() + 6 * DAY) };
}

/** The week before a week. */
export function previousWeekOf(week: { from: Date; to: Date }): { from: Date; to: Date } {
  return { from: new Date(week.from.getTime() - 7 * DAY), to: new Date(week.to.getTime() - 7 * DAY) };
}

/** `part` as a share of `total` in percent with one decimal; nothing recorded is 0. */
export function sharePercent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}

/** What a share opens: the sets with that Flag or Action, or the sets with any Flag other than Normal. */
export const DASHBOARD_KINDS = ["flag", "action", "nonNormal"] as const;
export type DashboardKind = (typeof DASHBOARD_KINDS)[number];

/** The week (any day in it, dd/MM/yyyy; this week when empty) and branch of the dashboard. */
export const workoutDashboardQuerySchema = z.object({
  week: optional(calendarDate),
  branchId: optional(z.uuid({ error: "invalidChoice" })),
});

/** The sets behind one share. */
export const workoutDrillQuerySchema = workoutDashboardQuerySchema.extend({
  kind: z.enum(DASHBOARD_KINDS, { error: "invalidChoice" }),
  optionId: optional(z.uuid({ error: "invalidChoice" })),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const share = z.object({
  option: chosenOptionSchema.omit({ note: true }),
  sets: z.int(),
  percent: z.number(),
  previousSets: z.int(),
  previousPercent: z.number(),
});

const range = z.object({ from: instant, to: instant });

export const workoutDashboardSchema = z
  .object({
    week: range,
    previousWeek: range,
    /** Sets recorded in the week, the sessions they belong to and the customers who trained, and the week before's. */
    totals: z.object({
      sets: z.int(),
      sessions: z.int(),
      customers: z.int(),
      previousSets: z.int(),
      previousSessions: z.int(),
      previousCustomers: z.int(),
    }),
    flags: z.array(share),
    actions: z.array(share),
    /** Customers with at least one Flag other than Normal, and the week before's. */
    nonNormalCustomers: z.int(),
    previousNonNormalCustomers: z.int(),
    /** Escalations still waiting for the manager or the Master, whatever the week. */
    openEscalations: z.int(),
  })
  .meta({ id: "WorkoutDashboard" });

export const workoutDrillRowSchema = z.object({
  logId: z.uuid(),
  sessionDate: instant,
  branch: branchRefSchema,
  customer: z.object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() }),
  trainer: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }),
  exercise: z.string(),
  setNo: z.int(),
  flag: chosenOptionSchema,
  action: chosenOptionSchema,
  note: z.string().nullable(),
});

export const workoutDrillSchema = pageOf(workoutDrillRowSchema).meta({ id: "WorkoutDrill" });

export type WorkoutDashboard = z.output<typeof workoutDashboardSchema>;
export type WorkoutDashboardQuery = z.input<typeof workoutDashboardQuerySchema>;
export type WorkoutDrill = z.output<typeof workoutDrillSchema>;
export type WorkoutDrillRow = z.output<typeof workoutDrillRowSchema>;
