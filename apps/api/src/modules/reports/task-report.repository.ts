import { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { branchSql } from "./report-scope.js";

// The tasks report (brief §9, FR-TASK-006, A-045; M9.1). A task counts in the period its deadline falls in. A task is open
// until it is done or cancelled; open and past its deadline it is overdue.

export type TaskGroupRow = {
  userId: string | null;
  userName: string | null;
  departmentId: string | null;
  departmentVi: string | null;
  departmentEn: string | null;
  assigned: number;
  doneOnTime: number;
  doneLate: number;
  overdue: number;
  open: number;
  cancelled: number;
};

type Window = { from: Date; to: Date; now: Date };

type Raw = {
  user_id: string | null;
  user_name: string | null;
  department_id: string | null;
  label_vi: string | null;
  label_en: string | null;
  assigned: bigint;
  done_on_time: bigint;
  done_late: bigint;
  overdue: bigint;
  open: bigint;
  cancelled: bigint;
};

const toRow = (row: Raw): TaskGroupRow => ({
  userId: row.user_id,
  userName: row.user_name,
  departmentId: row.department_id,
  departmentVi: row.label_vi,
  departmentEn: row.label_en,
  assigned: Number(row.assigned),
  doneOnTime: Number(row.done_on_time),
  doneLate: Number(row.done_late),
  overdue: Number(row.overdue),
  open: Number(row.open),
  cancelled: Number(row.cancelled),
});

/**
 * One row per person the tasks were given to, with the department of their employee record. `window.from` and `window.to`
 * are the first instant of the period and the first instant after it.
 */
export async function groupsByPerson(
  db: Db,
  branches: string[] | "ALL",
  window: Window,
  userId: string | undefined,
): Promise<TaskGroupRow[]> {
  const rows = await db.$queryRaw<Raw[]>`
    SELECT u.id AS user_id, u.name AS user_name, d.id AS department_id, d.label_vi, d.label_en,
           COUNT(*) AS assigned,
           COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.done_at <= t.due_at) AS done_on_time,
           COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.done_at > t.due_at) AS done_late,
           COUNT(*) FILTER (WHERE t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND t.due_at < ${window.now}) AS overdue,
           COUNT(*) FILTER (WHERE t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND t.due_at >= ${window.now}) AS open,
           COUNT(*) FILTER (WHERE t.status = 'CANCELLED') AS cancelled
    FROM tasks t
    JOIN users u ON u.id = t.assignee_user_id
    LEFT JOIN employees e ON e.user_id = u.id
    LEFT JOIN options d ON d.id = e.department_option_id
    WHERE t.due_at >= ${window.from} AND t.due_at < ${window.to}
      AND ${branchSql(Prisma.sql`t.branch_id`, branches)}
      AND (${userId ?? null}::uuid IS NULL OR u.id = ${userId ?? null}::uuid)
    GROUP BY u.id, u.name, d.id, d.label_vi, d.label_en`;
  return rows.map(toRow);
}

/**
 * One row per department: the tasks given to the department, and those given to a person of it (the department of their
 * employee record). A task given to nobody in particular is in no row.
 */
export async function groupsByDepartment(
  db: Db,
  branches: string[] | "ALL",
  window: Window,
  userId: string | undefined,
): Promise<TaskGroupRow[]> {
  const rows = await db.$queryRaw<Raw[]>`
    SELECT NULL::uuid AS user_id, NULL::text AS user_name, d.id AS department_id, d.label_vi, d.label_en,
           COUNT(*) AS assigned,
           COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.done_at <= t.due_at) AS done_on_time,
           COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.done_at > t.due_at) AS done_late,
           COUNT(*) FILTER (WHERE t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND t.due_at < ${window.now}) AS overdue,
           COUNT(*) FILTER (WHERE t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND t.due_at >= ${window.now}) AS open,
           COUNT(*) FILTER (WHERE t.status = 'CANCELLED') AS cancelled
    FROM tasks t
    LEFT JOIN employees e ON e.user_id = t.assignee_user_id
    JOIN options d ON d.id = COALESCE(t.assignee_department_option_id, e.department_option_id)
    WHERE t.due_at >= ${window.from} AND t.due_at < ${window.to}
      AND ${branchSql(Prisma.sql`t.branch_id`, branches)}
      AND (${userId ?? null}::uuid IS NULL OR t.assignee_user_id = ${userId ?? null}::uuid)
    GROUP BY d.id, d.label_vi, d.label_en`;
  return rows.map(toRow);
}

/** The totals of the whole period, whoever the tasks were given to (a task given to nobody counts too). */
export async function totals(
  db: Db,
  branches: string[] | "ALL",
  window: Window,
  userId: string | undefined,
): Promise<Omit<TaskGroupRow, "userId" | "userName" | "departmentId" | "departmentVi" | "departmentEn">> {
  const [row] = await db.$queryRaw<Raw[]>`
    SELECT NULL::uuid AS user_id, NULL::text AS user_name, NULL::uuid AS department_id, NULL::text AS label_vi,
           NULL::text AS label_en,
           COUNT(*) AS assigned,
           COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.done_at <= t.due_at) AS done_on_time,
           COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.done_at > t.due_at) AS done_late,
           COUNT(*) FILTER (WHERE t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND t.due_at < ${window.now}) AS overdue,
           COUNT(*) FILTER (WHERE t.status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND t.due_at >= ${window.now}) AS open,
           COUNT(*) FILTER (WHERE t.status = 'CANCELLED') AS cancelled
    FROM tasks t
    WHERE t.due_at >= ${window.from} AND t.due_at < ${window.to}
      AND ${branchSql(Prisma.sql`t.branch_id`, branches)}
      AND (${userId ?? null}::uuid IS NULL OR t.assignee_user_id = ${userId ?? null}::uuid)`;
  const counts = toRow(row!);
  return {
    assigned: counts.assigned,
    doneOnTime: counts.doneOnTime,
    doneLate: counts.doneLate,
    overdue: counts.overdue,
    open: counts.open,
    cancelled: counts.cancelled,
  };
}
