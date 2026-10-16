import { onTimeRate, taskReportQuerySchema, type TaskReport, type TaskReportRow } from "@gymcrm/shared/reports";
import { prisma } from "../../platform/db/prisma.js";
import type { Actor } from "../../platform/auth/session.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { startOfGymDay } from "../bookings/booking.service.js";
import * as repo from "./task-report.repository.js";
import { assertWholeScope, branchesOf, periodOf } from "./report-scope.js";

// The tasks report (brief §9, FR-TASK-006, A-045; M9.1): the tasks given, done on time, done late and overdue, by person and by
// department, for the tasks whose deadline falls in the period.

const DAY = 86_400_000;

function toRow(row: repo.TaskGroupRow): TaskReportRow {
  return {
    user: row.userId ? { id: row.userId, name: row.userName ?? "" } : null,
    department: row.departmentId
      ? { id: row.departmentId, labelVi: row.departmentVi ?? "", labelEn: row.departmentEn ?? "" }
      : null,
    assigned: row.assigned,
    doneOnTime: row.doneOnTime,
    doneLate: row.doneLate,
    overdue: row.overdue,
    open: row.open,
    cancelled: row.cancelled,
    onTimeRate: onTimeRate(row),
  };
}

/** Most overdue first, then the most tasks, then by name, so the people who need a word are at the top. */
const order = (a: TaskReportRow, b: TaskReportRow) =>
  b.overdue - a.overdue ||
  b.assigned - a.assigned ||
  (a.user?.name ?? a.department?.labelVi ?? "").localeCompare(b.user?.name ?? b.department?.labelVi ?? "");

export async function taskReport(actor: Actor, rawQuery: unknown): Promise<TaskReport> {
  assertCan(actor, "report.tasks");
  assertWholeScope(actor, "tasks", "report.tasks");
  const query = parseInput(taskReportQuerySchema, rawQuery);
  const { from, to } = periodOf(query);
  const branches = branchesOf(actor, query.branchId);
  const window = { from: startOfGymDay(from), to: startOfGymDay(new Date(to.getTime() + DAY)), now: new Date() };
  const [people, departments, totals] = await Promise.all([
    repo.groupsByPerson(prisma, branches, window, query.userId),
    repo.groupsByDepartment(prisma, branches, window, query.userId),
    repo.totals(prisma, branches, window, query.userId),
  ]);
  return {
    from,
    to,
    byPerson: people.map(toRow).sort(order),
    byDepartment: departments.map(toRow).sort(order),
    totals: { ...totals, onTimeRate: onTimeRate(totals) },
  };
}
