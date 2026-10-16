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
  /** Its own reminder points, minutes before the deadline; empty for the shared ones (D-056). */
  reminderMinutes: number[];
};

export function createTask(
  db: Db,
  data: TaskWrite & {
    branchId: string;
    assignerId: string;
    entityType: string | null;
    entityId: string | null;
    source?: string;
  },
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

/**
 * The records tasks are about, by id: how they are shown and what they are now. A task
 * about a lead is about a customer once the lead showed (D-019, same id).
 */
export async function entityRefs(
  db: Db,
  refs: { type: string; id: string }[],
): Promise<Map<string, { label: string; type: "lead" | "customer" | "contract" | "workoutLog" }>> {
  const ids = (...types: string[]) => refs.filter((ref) => types.includes(ref.type)).map((ref) => ref.id);
  const [people, contracts, logs] = await Promise.all([
    db.customer.findMany({
      where: { id: { in: ids("lead", "customer") } },
      select: { id: true, stage: true, leadCode: true, customerCode: true, fullName: true },
    }),
    db.contract.findMany({
      where: { id: { in: ids("contract") } },
      select: { id: true, contractCode: true, packageName: true },
    }),
    db.workoutLog.findMany({
      where: { id: { in: ids("workoutLog") } },
      select: {
        id: true,
        customer: { select: { customerCode: true, fullName: true } },
        booking: { select: { scheduledStart: true } },
      },
    }),
  ]);
  type Ref = { label: string; type: "lead" | "customer" | "contract" | "workoutLog" };
  const entries: [string, Ref][] = [
    ...people.map((p): [string, Ref] =>
      p.stage === "LEAD"
        ? [p.id, { label: `${p.leadCode} · ${p.fullName}`, type: "lead" }]
        : [p.id, { label: `${p.customerCode} · ${p.fullName}`, type: "customer" }],
    ),
    ...contracts.map((c): [string, Ref] => [c.id, { label: `${c.contractCode} · ${c.packageName}`, type: "contract" }]),
    ...logs.map((l): [string, Ref] => [
      l.id,
      { label: `${l.customer.customerCode} · ${l.customer.fullName}`, type: "workoutLog" },
    ]),
  ];
  return new Map(entries);
}

/** The open task the system made for a record, e.g. Báo Studio's for a lead. */
export function findSystemTask(
  db: Db,
  source: string,
  entityType: string,
  entityId: string,
): Promise<TaskRecord | null> {
  return db.task.findFirst({
    where: { source, entityType, entityId, status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS"] } },
    include: withRefs,
    orderBy: { createdAt: "desc" },
  });
}

export async function updateSystemTask(
  db: Db,
  id: string,
  data: { title: string; description: string | null; dueAt: Date },
) {
  const before = await db.task.findUniqueOrThrow({ where: { id }, select: { dueAt: true } });
  // A new deadline gets its own reminders (D-056).
  if (before.dueAt.getTime() !== data.dueAt.getTime()) await clearReminders(db, id);
  return db.task.update({ where: { id }, data, include: withRefs });
}

/** Open tasks with their deadline ahead, no later than `until`, and the reminder points already sent (D-056). */
export function remindable(db: Db, now: Date, until: Date) {
  return db.task.findMany({
    where: { status: { in: [...OPEN] }, dueAt: { gt: now, lte: until } },
    select: {
      id: true,
      title: true,
      branchId: true,
      assignerId: true,
      assigneeUserId: true,
      assigneeDepartmentId: true,
      dueAt: true,
      reminderMinutes: true,
      reminders: { select: { minutesBefore: true } },
    },
    orderBy: { dueAt: "asc" },
  });
}

const OPEN = ["NEW", "ACCEPTED", "IN_PROGRESS"] as const;

/**
 * Marks reminder points as sent and returns those this call marked: another worker running at once marks
 * the rest, so each point goes out once (T-059, D-056).
 */
export async function claimPoints(db: Db, taskId: string, points: number[], now: Date): Promise<Set<number>> {
  const created = await db.taskReminder.createManyAndReturn({
    data: points.map((minutesBefore) => ({ taskId, minutesBefore, sentAt: now })),
    skipDuplicates: true,
    select: { minutesBefore: true },
  });
  return new Set(created.map((row) => row.minutesBefore));
}

/** A new deadline gets its own reminders: the points sent for the old one are forgotten (D-056). */
export async function clearReminders(db: Db, taskId: string): Promise<void> {
  await db.taskReminder.deleteMany({ where: { taskId } });
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
