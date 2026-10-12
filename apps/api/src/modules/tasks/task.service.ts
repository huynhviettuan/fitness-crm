import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { inBranches, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen } from "../../platform/options/option.service.js";
import { notify, type NewNotification } from "../../platform/notifications/notification.service.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import { leadsVisibleTo } from "../customers/person.service.js";
import { instantAt } from "@flow/shared/validation";
import {
  MAX_REMINDER_MINUTES,
  OPEN_TASK_STATUSES,
  dueReminders,
  formatReminderHours,
  listTasksSchema,
  parseReminderHours,
  taskCommentSchema,
  taskInputSchema,
  taskUpdateSchema,
  type Task as TaskView,
  type TaskAction,
  type TaskAssignees,
  type TaskDetail,
  type TaskEntityType,
  type TaskStatus,
  type TaskSummary,
} from "@flow/shared/tasks";
import * as repo from "./task.repository.js";

// Giao việc (brief §8.2, D-037). Fixed flow: assign → the assignee (or a member of the
// department) accepts → in progress → done; the assigner can cancel. Everyone sees what
// they gave, what they got, and their department's; "all" scope sees the branch's.

const AUDITED_FIELDS = [
  "title",
  "description",
  "assigneeUserId",
  "assigneeDepartmentId",
  "dueAt",
  "priority",
  "reminderMinutes",
  "status",
] as const;

type Me = { actor: Actor; departmentId: string | null };

async function me(db: Db, actor: Actor): Promise<Me> {
  return { actor, departmentId: await repo.departmentOfUser(db, actor.id) };
}

/** The tasks an actor may see (D-017 scope "tasks"). */
function tasksVisibleTo({ actor, departmentId }: Me): Prisma.TaskWhereInput {
  const own: Prisma.TaskWhereInput = {
    OR: [
      { assignerId: actor.id },
      { assigneeUserId: actor.id },
      ...(departmentId ? [{ assigneeDepartmentId: departmentId }] : []),
    ],
  };
  return { AND: [inBranches(actor), isOwnOnly(actor, "tasks") ? own : {}] };
}

function viewWhere(
  { actor, departmentId }: Me,
  view: "mine" | "assigned" | "department" | "all",
): Prisma.TaskWhereInput {
  switch (view) {
    case "mine":
      // Given to me, or waiting in my department for someone to accept it.
      return {
        OR: [
          { assigneeUserId: actor.id },
          ...(departmentId ? [{ assigneeUserId: null, assigneeDepartmentId: departmentId }] : []),
        ],
      };
    case "assigned":
      return { assignerId: actor.id };
    case "department":
      return departmentId ? { assigneeDepartmentId: departmentId } : { id: { in: [] } };
    case "all":
      if (isOwnOnly(actor, "tasks")) throw forbidden(actor, "task.view", "all tasks without the all-tasks scope");
      return {};
  }
}

const openWhere = (now: Date): Prisma.TaskWhereInput => ({
  status: { in: [...OPEN_TASK_STATUSES] },
  dueAt: { lt: now },
});

export async function listTasks(actor: Actor, rawQuery: unknown) {
  assertCan(actor, "task.view");
  const query = parseInput(listTasksSchema, rawQuery);
  const self = await me(prisma, actor);
  const where: Prisma.TaskWhereInput = {
    AND: [
      tasksVisibleTo(self),
      viewWhere(self, query.view),
      { status: query.status },
      query.overdueOnly ? openWhere(new Date()) : {},
      query.q ? { title: { contains: query.q, mode: "insensitive" } } : {},
    ],
  };
  const { items, total } = await repo.listTasks(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: await toViews(prisma, self, items), total, page: query.page, pageSize: query.pageSize };
}

/** "Việc của tôi" in numbers: my open tasks and how many are past their deadline. */
export async function taskSummary(actor: Actor): Promise<TaskSummary> {
  if (!actor.permissions.has("task.view")) return { open: 0, overdue: 0 };
  const self = await me(prisma, actor);
  const mine = { AND: [tasksVisibleTo(self), viewWhere(self, "mine"), { status: { in: [...OPEN_TASK_STATUSES] } }] };
  const [open, overdue] = await Promise.all([
    repo.countTasks(prisma, mine),
    repo.countTasks(prisma, { AND: [mine, openWhere(new Date())] }),
  ]);
  return { open, overdue };
}

export async function getTask(actor: Actor, id: string): Promise<TaskDetail> {
  assertCan(actor, "task.view");
  const self = await me(prisma, actor);
  const task = await visibleTask(prisma, self, id);
  return detail(prisma, self, task);
}

export async function createTask(actor: Actor, input: unknown): Promise<TaskDetail> {
  assertCan(actor, "task.create");
  const data = parseInput(taskInputSchema, input);
  return prisma.$transaction(async (tx) => {
    // A task about a record belongs to the record's branch (A-031); otherwise to the chosen one.
    const branchId =
      data.entityType && data.entityId
        ? await entityBranch(tx, actor, data.entityType, data.entityId)
        : await resolveBranch(tx, actor, data.branchId);
    await assertAssignee(tx, data, branchId);
    const task = await repo.createTask(tx, {
      branchId,
      assignerId: actor.id,
      title: data.title,
      description: data.description,
      assigneeUserId: data.assigneeUserId,
      assigneeDepartmentId: data.assigneeDepartmentId,
      dueAt: instantAt(data.dueDate, data.dueTime, env.GYM_TIMEZONE),
      priority: data.priority,
      reminderMinutes: data.reminders ?? [],
      entityType: data.entityType,
      entityId: data.entityId,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "task",
      entityId: task.id,
      action: "task.created",
      after: { ...pick(task, AUDITED_FIELDS), entityType: task.entityType, entityId: task.entityId },
    });
    await notifyAssignees(tx, task, actor.id, {
      kind: "taskAssigned",
      params: { title: task.title, by: task.assigner.name },
      link: link(task),
    });
    return detail(tx, await me(tx, actor), task);
  });
}

/** The assigner (or "all" scope) edits an open task. A new assignee starts again from NEW. */
export async function updateTask(
  actor: Actor,
  id: string,
  input: unknown,
  now: Date = new Date(),
): Promise<TaskDetail> {
  assertCan(actor, "task.view");
  const data = parseInput(taskUpdateSchema, input);
  return changeLocked(actor, id, async (tx, self, before) => {
    if (!actionsFor(self, before).includes("edit")) throw notAllowed(actor, before, "edit");
    await assertAssignee(tx, data, before.branchId);
    const dueAt = instantAt(data.dueDate, data.dueTime, env.GYM_TIMEZONE);
    const reassigned =
      data.assigneeUserId !== before.assigneeUserId || data.assigneeDepartmentId !== before.assigneeDepartmentId;
    const after = await repo.updateTask(tx, id, {
      title: data.title,
      description: data.description,
      assigneeUserId: data.assigneeUserId,
      assigneeDepartmentId: data.assigneeDepartmentId,
      dueAt,
      priority: data.priority,
      reminderMinutes: data.reminders ?? [],
      ...(reassigned ? { status: "NEW", acceptedAt: null, startedAt: null } : {}),
      // A new deadline gets its own reminders.
      ...(dueAt.getTime() !== before.dueAt.getTime() ? { overdueNotifiedAt: null } : {}),
    });
    await resetReminders(tx, before, after, now);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    if (changes)
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "task",
        entityId: id,
        action: "task.updated",
        ...changes,
      });
    if (reassigned) {
      await notifyAssignees(tx, after, actor.id, {
        kind: "taskAssigned",
        params: { title: after.title, by: after.assigner.name },
        link: link(after),
      });
    }
    return after;
  });
}

const TRANSITIONS: Record<
  "accept" | "start" | "complete" | "cancel",
  { from: readonly TaskStatus[]; to: TaskStatus; at: "acceptedAt" | "startedAt" | "doneAt" | "cancelledAt" }
> = {
  accept: { from: ["NEW"], to: "ACCEPTED", at: "acceptedAt" },
  start: { from: ["ACCEPTED"], to: "IN_PROGRESS", at: "startedAt" },
  complete: { from: ["ACCEPTED", "IN_PROGRESS"], to: "DONE", at: "doneAt" },
  cancel: { from: OPEN_TASK_STATUSES, to: "CANCELLED", at: "cancelledAt" },
};

/**
 * Moves a task along its fixed flow, under its row lock. Repeating a move that already
 * happened returns the task as it is; two people accepting a department's task at once
 * leave it with the first, and the second is INVALID_STATUS_TRANSITION.
 */
export async function moveTask(actor: Actor, id: string, action: keyof typeof TRANSITIONS): Promise<TaskDetail> {
  assertCan(actor, "task.view");
  const { from, to, at } = TRANSITIONS[action];
  return changeLocked(actor, id, async (tx, self, before) => {
    const mineAlready = before.status === to && (action === "cancel" || before.assigneeUserId === actor.id);
    if (mineAlready) return before;
    if (!from.includes(before.status)) throw new AppError("INVALID_STATUS_TRANSITION");
    if (!actionsFor(self, before).includes(action)) throw forbidden(actor, "task.view", `task ${action} not allowed`);
    const after = await repo.updateTask(tx, id, {
      status: to,
      [at]: new Date(),
      ...(action === "accept" ? { assigneeUserId: actor.id } : {}),
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "task",
      entityId: id,
      action: `task.${action === "complete" ? "completed" : action === "cancel" ? "cancelled" : action === "accept" ? "accepted" : "started"}`,
      before: { status: before.status, ...(action === "accept" ? { assigneeUserId: before.assigneeUserId } : {}) },
      after: { status: to, ...(action === "accept" ? { assigneeUserId: actor.id } : {}) },
    });
    const params = { title: after.title, by: actorName(after, actor.id) };
    if (action === "accept") await notify(tx, [after.assignerId], { kind: "taskAccepted", params, link: link(after) });
    if (action === "complete")
      await notify(tx, [after.assignerId], { kind: "taskCompleted", params, link: link(after) });
    if (action === "cancel")
      await notifyAssignees(tx, after, actor.id, { kind: "taskCancelled", params, link: link(after) });
    return after;
  });
}

/** Anyone who sees the task may comment; mentioned people, the assigner, and the assignee are told. */
export async function addComment(actor: Actor, id: string, input: unknown): Promise<TaskDetail> {
  assertCan(actor, "task.view");
  const data = parseInput(taskCommentSchema, input);
  return changeLocked(actor, id, async (tx, self, task) => {
    if (!actionsFor(self, task).includes("comment")) throw notAllowed(actor, task, "comment");
    const mentions = [...new Set(data.mentions)];
    const usable = await repo.usableUsers(tx, mentions, task.branchId);
    if (mentions.some((userId) => !usable.has(userId)))
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { mentions: ["invalidChoice"] } });
    const comment = await repo.createComment(tx, { taskId: id, authorId: actor.id, body: data.body, mentions });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "task",
      entityId: id,
      action: "task.commented",
      after: { commentId: comment.id, body: data.body, mentions },
    });
    const author = (await repo.namesOf(tx, [actor.id]))[0]?.name ?? "";
    const params = { title: task.title, by: author };
    const others = [task.assignerId, task.assigneeUserId].filter(
      (userId) => userId && userId !== actor.id && !mentions.includes(userId),
    );
    await notify(
      tx,
      mentions.filter((userId) => userId !== actor.id),
      { kind: "taskMentioned", params, link: link(task) },
    );
    await notify(tx, others, { kind: "taskCommented", params, link: link(task) });
    return task;
  });
}

/** People and departments a task can go to in the actor's branches. */
export async function taskAssignees(actor: Actor): Promise<TaskAssignees> {
  assertCan(actor, "task.view");
  const [users, departments] = await Promise.all([
    repo.assignableUsers(prisma, actor.branches),
    repo.activeDepartments(prisma),
  ]);
  return {
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      department: user.employee?.department ? chosen(user.employee.department, user.employee.departmentNote) : null,
    })),
    departments,
  };
}

// ---------------------------------------------------------------- reminders

/** The shared reminder points, minutes before the deadline, longest first (parameter taskReminderHours, D-056). */
export async function sharedReminderMinutes(db: Db): Promise<number[]> {
  const parsed = parseReminderHours(await readParameter(db, "taskReminderHours"));
  return "minutes" in parsed ? parsed.minutes : [];
}

/**
 * A new deadline gets its own reminders; a new list of points does not fire for a point that has already
 * passed (D-056), so adding "12 hours" with six hours left tells nobody at once.
 */
async function resetReminders(db: Db, before: repo.TaskRecord, after: repo.TaskRecord, now: Date): Promise<void> {
  if (after.dueAt.getTime() !== before.dueAt.getTime()) return repo.clearReminders(db, after.id);
  const shared = await sharedReminderMinutes(db);
  const had = new Set(before.reminderMinutes.length > 0 ? before.reminderMinutes : shared);
  const added = (after.reminderMinutes.length > 0 ? after.reminderMinutes : shared).filter(
    (point) => !had.has(point) && after.dueAt.getTime() - point * 60_000 <= now.getTime(),
  );
  if (added.length > 0) await repo.claimPoints(db, after.id, added, now);
}

/**
 * Brief §8.2, D-056: the assignee is reminded at each point before the deadline (24, 3, and 1 hours,
 * or the task's own), and when it passes, the assignee and the assigner are told. Each once. When
 * several points have come at once, only the tightest is told. Run by the worker every minute
 * (T-059); returns how many reminders went out.
 */
export async function remindTasks(now: Date = new Date()): Promise<{ dueSoon: number; overdue: number }> {
  const shared = await sharedReminderMinutes(prisma);
  return prisma.$transaction(async (tx) => {
    const overdue = await repo.claimOverdue(tx, now);
    for (const row of overdue) {
      const notification: NewNotification = {
        kind: "taskOverdue",
        params: { title: row.title, due: due(row.due_at) },
        link: `/tasks/${row.id}`,
      };
      await notify(tx, [...(await rowAssignees(tx, row)), row.assigner_id], notification);
    }
    let told = 0;
    const horizon = new Date(now.getTime() + MAX_REMINDER_MINUTES * 60_000);
    for (const task of await repo.remindable(tx, now, horizon)) {
      const points = task.reminderMinutes.length > 0 ? task.reminderMinutes : shared;
      const { tell, mark } = dueReminders(
        points,
        new Set(task.reminders.map((sent) => sent.minutesBefore)),
        task.dueAt,
        now,
      );
      if (mark.length === 0) continue;
      const claimed = await repo.claimPoints(tx, task.id, mark, now);
      if (tell === null || !claimed.has(tell)) continue;
      await notify(
        tx,
        await rowAssignees(tx, {
          assignee_user_id: task.assigneeUserId,
          assignee_department_option_id: task.assigneeDepartmentId,
          branch_id: task.branchId,
        }),
        {
          kind: "taskDueSoon",
          params: { title: task.title, due: due(task.dueAt), hours: formatReminderHours([tell]) },
          link: `/tasks/${task.id}`,
        },
      );
      told += 1;
    }
    return { dueSoon: told, overdue: overdue.length };
  });
}

async function rowAssignees(
  db: Db,
  row: Pick<repo.ReminderRow, "assignee_user_id" | "assignee_department_option_id" | "branch_id">,
): Promise<string[]> {
  if (row.assignee_user_id) return [row.assignee_user_id];
  return row.assignee_department_option_id
    ? repo.departmentMembers(db, row.assignee_department_option_id, row.branch_id)
    : [];
}

// ---------------------------------------------------------------- helpers

/** What the actor may do with the task now; the API checks the same list before acting. */
function actionsFor({ actor, departmentId }: Me, task: repo.TaskRecord): TaskAction[] {
  const actions: TaskAction[] = [];
  const open = (OPEN_TASK_STATUSES as readonly string[]).includes(task.status);
  const mine = task.assigneeUserId === actor.id;
  const waitingInMyDepartment =
    task.assigneeUserId === null && departmentId !== null && task.assigneeDepartmentId === departmentId;
  const oversees = task.assignerId === actor.id || !isOwnOnly(actor, "tasks");
  if (task.status === "NEW" && (mine || waitingInMyDepartment)) actions.push("accept");
  if (task.status === "ACCEPTED" && mine) actions.push("start");
  if ((task.status === "ACCEPTED" || task.status === "IN_PROGRESS") && mine) actions.push("complete");
  if (open && oversees) actions.push("cancel", "edit");
  actions.push("comment");
  return actions;
}

async function changeLocked(
  actor: Actor,
  id: string,
  change: (tx: Prisma.TransactionClient, self: Me, task: repo.TaskRecord) => Promise<repo.TaskRecord>,
): Promise<TaskDetail> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockTask(tx, id))) throw new AppError("NOT_FOUND");
    const self = await me(tx, actor);
    const task = await visibleTask(tx, self, id);
    const after = await change(tx, self, task);
    return detail(tx, self, after);
  });
}

async function visibleTask(db: Db, self: Me, id: string): Promise<repo.TaskRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const task = await repo.findTask(db, id, tasksVisibleTo(self));
  if (!task) throw new AppError("NOT_FOUND");
  return task;
}

/** A done or cancelled task is a conflict; anything else the actor may not do is forbidden. */
function notAllowed(actor: Actor, task: repo.TaskRecord, what: string): AppError {
  if (!(OPEN_TASK_STATUSES as readonly string[]).includes(task.status))
    return new AppError("INVALID_STATUS_TRANSITION");
  return forbidden(actor, "task.view", `task ${what} not allowed`);
}

/** One active person who works in the branch, or an active department (not "Khác"). */
async function assertAssignee(
  db: Db,
  data: { assigneeUserId: string | null; assigneeDepartmentId: string | null },
  branchId: string,
) {
  if (data.assigneeUserId && !(await repo.usableUsers(db, [data.assigneeUserId], branchId)).has(data.assigneeUserId)) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { assigneeUserId: ["invalidChoice"] } });
  }
  if (data.assigneeDepartmentId) {
    const department = await repo.findDepartment(db, data.assigneeDepartmentId);
    if (!department?.active || department.isOther)
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { assigneeDepartmentId: ["invalidChoice"] } });
  }
}

/** The linked record must be one the actor can see; the task takes its branch. */
async function entityBranch(db: Db, actor: Actor, type: TaskEntityType, id: string): Promise<string> {
  const found =
    type === "lead"
      ? await db.customer.findFirst({ where: { AND: [{ id }, leadsVisibleTo(actor)] }, select: { branchId: true } })
      : type === "customer"
        ? await db.customer.findFirst({
            where: { AND: [{ id }, customersVisibleTo(actor)] },
            select: { branchId: true },
          })
        : await db.contract.findFirst({
            where: { AND: [{ id }, contractsVisibleTo(actor)] },
            select: { branchId: true },
          });
  if (!found) throw new AppError("VALIDATION_FAILED", { fieldErrors: { entityId: ["invalidChoice"] } });
  return found.branchId;
}

async function notifyAssignees(db: Db, task: repo.TaskRecord, except: string, notification: NewNotification) {
  const users = task.assigneeUserId
    ? [task.assigneeUserId]
    : task.assigneeDepartmentId
      ? await repo.departmentMembers(db, task.assigneeDepartmentId, task.branchId)
      : [];
  await notify(
    db,
    users.filter((userId) => userId !== except),
    notification,
  );
}

function actorName(task: repo.TaskRecord, actorId: string): string {
  if (task.assigner.id === actorId) return task.assigner.name;
  return task.assigneeUser?.id === actorId ? task.assigneeUser.name : "";
}

function link(task: { id: string }): string {
  return `/tasks/${task.id}`;
}

/** A deadline as notifications show it: dd/MM/yyyy HH:mm in the gym's time (A-001). */
function due(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: env.GYM_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

async function toViews(db: Db, self: Me, tasks: repo.TaskRecord[]): Promise<TaskView[]> {
  const refs = await repo.entityRefs(
    db,
    tasks
      .filter((task) => task.entityType && task.entityId)
      .map((task) => ({ type: task.entityType!, id: task.entityId! })),
  );
  const now = Date.now();
  const shared = await sharedReminderMinutes(db);
  return tasks.map((task) => ({
    id: task.id,
    branch: task.branch,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    reminderMinutes: task.reminderMinutes.length > 0 ? task.reminderMinutes : null,
    reminders: task.reminderMinutes.length > 0 ? task.reminderMinutes : shared,
    overdue: (OPEN_TASK_STATUSES as readonly string[]).includes(task.status) && task.dueAt.getTime() < now,
    assigner: task.assigner,
    assignee: task.assigneeUser,
    department: task.assigneeDepartment && chosen(task.assigneeDepartment, null),
    entity:
      task.entityType && task.entityId
        ? {
            type: refs.get(task.entityId)?.type ?? (task.entityType as TaskEntityType),
            id: task.entityId,
            label: refs.get(task.entityId)?.label ?? task.entityId,
          }
        : null,
    createdAt: task.createdAt,
    acceptedAt: task.acceptedAt,
    doneAt: task.doneAt,
    cancelledAt: task.cancelledAt,
    actions: actionsFor(self, task),
  }));
}

async function detail(db: Db, self: Me, task: repo.TaskRecord): Promise<TaskDetail> {
  const [[view], comments] = await Promise.all([toViews(db, self, [task]), repo.listComments(db, task.id)]);
  const mentioned = await repo.namesOf(db, [...new Set(comments.flatMap((comment) => comment.mentions))]);
  const names = new Map(mentioned.map((user) => [user.id, user]));
  return {
    ...view,
    comments: comments.map((comment) => ({
      id: comment.id,
      author: comment.author,
      body: comment.body,
      mentions: comment.mentions
        .map((userId) => names.get(userId))
        .filter((user): user is { id: string; name: string } => Boolean(user)),
      createdAt: comment.createdAt,
    })),
  };
}

/**
 * Báo Studio (brief §4.1, §8.2): the system tells the studio about a lead's visit through
 * Giao việc. The first time it makes a task for the studio's department; later it updates
 * that task (deadline, details) and comments, so the studio has one task per visit.
 * Without a department set (parameter studioDepartmentId, OQ-032) nothing is sent.
 */
export async function upsertStudioTask(
  db: Db,
  input: {
    lead: { id: string; branchId: string };
    by: string;
    title: string;
    description: string;
    dueAt: Date;
    comment: string;
  },
): Promise<repo.TaskRecord | null> {
  const departmentId = await readParameter(db, "studioDepartmentId");
  const department = departmentId ? await repo.findDepartment(db, departmentId) : null;
  if (!department?.active || department.isOther) return null;

  const existing = await repo.findSystemTask(db, "studio", "lead", input.lead.id);
  if (existing) {
    const task = await repo.updateSystemTask(db, existing.id, {
      title: input.title,
      description: input.description,
      dueAt: input.dueAt,
    });
    await repo.createComment(db, { taskId: task.id, authorId: input.by, body: input.comment, mentions: [] });
    await recordAudit(db, {
      actorUserId: input.by,
      entityType: "task",
      entityId: task.id,
      action: "task.updated",
      before: pick(existing, ["title", "description", "dueAt"]),
      after: pick(task, ["title", "description", "dueAt"]),
      context: { source: "studio" },
    });
    const author = (await repo.namesOf(db, [input.by]))[0]?.name ?? "";
    await notifyAssignees(db, task, input.by, {
      kind: "taskCommented",
      params: { title: task.title, by: author },
      link: link(task),
    });
    return task;
  }
  const task = await repo.createTask(db, {
    branchId: input.lead.branchId,
    assignerId: input.by,
    title: input.title,
    description: input.description,
    assigneeUserId: null,
    assigneeDepartmentId: department.id,
    dueAt: input.dueAt,
    priority: "NORMAL",
    reminderMinutes: [],
    entityType: "lead",
    entityId: input.lead.id,
    source: "studio",
  });
  await recordAudit(db, {
    actorUserId: input.by,
    entityType: "task",
    entityId: task.id,
    action: "task.created",
    after: { ...pick(task, AUDITED_FIELDS), entityType: "lead", entityId: input.lead.id },
    context: { source: "studio" },
  });
  await notifyAssignees(db, task, input.by, {
    kind: "taskAssigned",
    params: { title: task.title, by: task.assigner.name },
    link: link(task),
  });
  return task;
}

/**
 * An email that could not be sent (FR-MAIL-003): a task for reception, who tell the customer another way. Without a
 * reception department set (parameter receptionDepartmentId) no task is made; the email still shows as failed.
 * Returns the task's id.
 */
export async function createMailFailureTask(
  db: Db,
  input: {
    person: { id: string; branchId: string };
    by: string;
    title: string;
    description: string;
    dueAt: Date;
  },
): Promise<string | null> {
  const departmentId = await readParameter(db, "receptionDepartmentId");
  const department = departmentId ? await repo.findDepartment(db, departmentId) : null;
  if (!department?.active || department.isOther) return null;
  const task = await repo.createTask(db, {
    branchId: input.person.branchId,
    assignerId: input.by,
    title: input.title,
    description: input.description,
    assigneeUserId: null,
    assigneeDepartmentId: department.id,
    dueAt: input.dueAt,
    priority: "NORMAL",
    reminderMinutes: [],
    entityType: "customer",
    entityId: input.person.id,
    source: "mail",
  });
  await recordAudit(db, {
    actorUserId: input.by,
    entityType: "task",
    entityId: task.id,
    action: "task.created",
    after: { ...pick(task, AUDITED_FIELDS), entityType: "customer", entityId: input.person.id },
    context: { source: "mail" },
  });
  await notifyAssignees(db, task, input.by, {
    kind: "taskAssigned",
    params: { title: task.title, by: task.assigner.name },
    link: link(task),
  });
  return task.id;
}
