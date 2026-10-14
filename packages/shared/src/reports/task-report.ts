import { z } from "zod";
import { periodReportQuerySchema } from "../finance/cash-book.js";
import { instant } from "../validation/index.js";

// The tasks report (brief §9 "Giao việc", FR-TASK-006, A-045; M9.1): tasks given, done on time, done late and overdue, by
// person and by department. A task counts in the period its deadline falls in.

/** The period and branch of every report, and the person the tasks were given to. */
export const taskReportQuerySchema = periodReportQuerySchema.extend({
  userId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "invalidChoice" }).optional()),
});
export type TaskReportQuery = z.input<typeof taskReportQuerySchema>;

const counts = {
  /** Tasks whose deadline is in the period. */
  assigned: z.int(),
  /** Done by the deadline. */
  doneOnTime: z.int(),
  /** Done after the deadline. */
  doneLate: z.int(),
  /** Not done and past the deadline now. */
  overdue: z.int(),
  /** Not done and not yet due. */
  open: z.int(),
  /** Cancelled: not counted in the rate. */
  cancelled: z.int(),
  /** Done on time ÷ (done + overdue), in percent; 0 when none is decided yet. */
  onTimeRate: z.int(),
};

export const taskReportRowSchema = z.object({
  /** The person the tasks were given to; empty on a department row. */
  user: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The department: the person's, or the one a task was given to. */
  department: z.object({ id: z.uuid(), labelVi: z.string(), labelEn: z.string() }).nullable(),
  ...counts,
});

export const taskReportSchema = z
  .object({
    from: instant,
    to: instant,
    byPerson: z.array(taskReportRowSchema),
    byDepartment: z.array(taskReportRowSchema),
    totals: z.object(counts),
  })
  .meta({ id: "TaskReport" });

export type TaskReport = z.output<typeof taskReportSchema>;
export type TaskReportRow = z.output<typeof taskReportRowSchema>;

/** Done on time ÷ (done + overdue), in whole percent: the tasks still open and not yet due are not judged. */
export function onTimeRate(counts: { doneOnTime: number; doneLate: number; overdue: number }): number {
  const decided = counts.doneOnTime + counts.doneLate + counts.overdue;
  return decided === 0 ? 0 : Math.round((counts.doneOnTime / decided) * 100);
}
