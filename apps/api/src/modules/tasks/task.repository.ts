import type { Db } from "../../platform/db/prisma.js";
import { Prisma, type TaskPriority, type TaskStatus } from "../../generated/prisma/client.js";
import { chosenSelect } from "../../platform/options/option.service.js";
import { activeInBranch } from "../../platform/notifications/notification.service.js";

const withRefs = {
  branch: { select: { id: true, name: true } },
  assigner: { select: { id: true, name: true } },
  assigneeUser: { select: { id: true, name: true } },
  assigneeDepartment: { select: chosenSelect },
} as const satisfies Prisma.TaskInclude;

export type TaskRecord = Prisma.TaskGetPayload<{ include: typeof withRefs }>;

export type TaskWrite = {
  title: string;
  description: string | null;
  assigneeUserId: string | null;
  assigneeDepartmentId: string | null;
  dueAt: Date;
  priority: TaskPriority;
};

export function createTask(
  db: Db,
  data: TaskWrite & { branchId: string; assignerId: string; entityType: string | null; entityId: string | null },
): Promise<TaskRecord> {
  return db.task.create({ data, include: withRefs });
}

export function findTask(db: Db, id: string, visibility: Prisma.TaskWhereInput = {}): Promise<TaskRecord | null> {
  return db.task.findFirst({ where: { AND: [{ id }, visibility] }, include: withRefs });
}

/** Holds the task's row until the transaction ends, so two changes never interleave. */
export async function lockTask(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "tasks" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export function updateTask(db: Db, id: string, data: Prisma.TaskUncheckedUpdateInput): Promise<TaskRecord> {
  return db.task.update({ where: { id }, data, include: withRefs });
}

export async function listTasks(
  db: Db,
  where: Prisma.TaskWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: TaskRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    // Open tasks first (the status enum is in lifecycle order), soonest deadline first.
    db.task.findMany({
      where,
      include: withRefs,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
      ...page,
    }),
    db.task.count({ where }),
  ]);
  return { items, total };
}

export function countTasks(db: Db, where: Prisma.TaskWhereInput): Promise<number> {
  return db.task.count({ where });
}

export function listComments(db: Db, taskId: string) {
  return db.taskComment.findMany({
    where: { taskId },
    select: { id: true, body: true, mentions: true, createdAt: true, author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export function createComment(db: Db, data: { taskId: string; authorId: string; body: string; mentions: string[] }) {
  return db.taskComment.create({ data, select: { id: true } });
}

export function namesOf(db: Db, userIds: string[]) {
  return db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
}

/** The department of the employee a login belongs to, if any (brief §8.4). */
export async function departmentOfUser(db: Db, userId: string): Promise<string | null> {
  const employee = await db.employee.findUnique({ where: { userId }, select: { departmentId: true } });
  return employee?.departmentId ?? null;
}

/** Active users of the branch whose employee is in the department. */
export async function departmentMembers(db: Db, departmentId: string, branchId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { AND: [activeInBranch(branchId), { employee: { departmentId } }] },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** Which of these users are active and work in the branch. */
export async function usableUsers(db: Db, userIds: string[], branchId: string): Promise<Set<string>> {
  const users = await db.user.findMany({
    where: { AND: [{ id: { in: userIds } }, activeInBranch(branchId)] },
    select: { id: true },
  });
  return new Set(users.map((user) => user.id));
}

/** Active users of the given branches (or all), with their employee's department. */
export function assignableUsers(db: Db, branches: "ALL" | readonly string[]) {
  return db.user.findMany({
    where: {
      status: "ACTIVE",
      ...(branches === "ALL"
        ? {}
        : { OR: [{ allBranches: true }, { branches: { some: { branchId: { in: [...branches] } } } }] }),
    },
    select: {
      id: true,
      name: true,
      employee: { select: { department: { select: chosenSelect }, departmentNote: true } },
    },
    orderBy: { name: "asc" },
  });
}

export function activeDepartments(db: Db) {
  return db.option.findMany({
    where: { listKey: "departments", active: true, isOther: false },
    select: { id: true, labelVi: true, labelEn: true, isOther: true },
    orderBy: [{ sortOrder: "asc" }, { labelVi: "asc" }],
  });
}

export function findDepartment(db: Db, id: string) {
  return db.option.findFirst({
    where: { id, listKey: "departments" },
    select: { id: true, active: true, isOther: true },
  });
}

/** Labels of the records tasks are about, by id. */
export async function entityLabels(db: Db, refs: { type: string; id: string }[]): Promise<Map<string, string>> {
  const ids = (type: string) => refs.filter((ref) => ref.type === type).map((ref) => ref.id);
  const [customers, contracts] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: ids("customer") } },
      select: { id: true, customerCode: true, fullName: true },
    }),
    db.contract.findMany({
      where: { id: { in: ids("contract") } },
      select: { id: true, contractCode: true, packageName: true },
    }),
  ]);
  return new Map([
    ...customers.map((c) => [c.id, `${c.customerCode} · ${c.fullName}`] as const),
    ...contracts.map((c) => [c.id, `${c.contractCode} · ${c.packageName}`] as const),
  ]);
}

/** Claims open tasks whose reminder is due and marks them, so each goes out once (T-059). */
export function claimDueSoon(db: Db, now: Date, until: Date) {
  return db.$queryRaw<ReminderRow[]>`
    UPDATE tasks SET due_soon_notified_at = ${now}
    WHERE status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND due_soon_notified_at IS NULL AND overdue_notified_at IS NULL
      AND due_at > ${now} AND due_at <= ${until}
    RETURNING ${REMINDER_COLUMNS}`;
}

export function claimOverdue(db: Db, now: Date) {
  return db.$queryRaw<ReminderRow[]>`
    UPDATE tasks SET overdue_notified_at = ${now}
    WHERE status IN ('NEW', 'ACCEPTED', 'IN_PROGRESS') AND overdue_notified_at IS NULL AND due_at <= ${now}
    RETURNING ${REMINDER_COLUMNS}`;
}

export type ReminderRow = {
  id: string;
  title: string;
  branch_id: string;
  assigner_id: string;
  assignee_user_id: string | null;
  assignee_department_option_id: string | null;
  due_at: Date;
};

// A fixed column list, spliced as raw SQL into the RETURNING clauses above.
const REMINDER_COLUMNS = Prisma.raw(
  "id, title, branch_id, assigner_id, assignee_user_id, assignee_department_option_id, due_at",
);

export type { TaskPriority, TaskStatus };
