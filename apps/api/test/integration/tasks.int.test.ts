import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import {
  addComment,
  createTask,
  getTask,
  listTasks,
  moveTask,
  remindTasks,
  taskAssignees,
  taskSummary,
  updateTask,
} from "../../src/modules/tasks/task.service.js";
import { createEmployee } from "../../src/modules/employees/employee.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { createRole } from "../../src/platform/roles/role.service.js";
import { resetDatabase } from "../support/database.js";
import { actorOf, createTestBranch, createTestOption, createTestUser, optionId } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const DUE = { dueDate: "20/10/2026", dueTime: "17:00" };

const notificationsOf = (userId: string) =>
  prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { kind: true, params: true, link: true },
  });

/** A user whose employee is in the department, as tasks see them. */
async function member(manager: Actor, departmentId: string, role: "RECEPTIONIST" | "PT" = "RECEPTIONIST") {
  const { user } = await createTestUser(role);
  await createEmployee(manager, { fullName: user.name, departmentId, userId: user.id });
  return actorOf(user.id);
}

describe("creating a task (brief §8.2)", () => {
  it("gives a task to a person, who is told; it is audited", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { name: "Quản lý Bảo" });
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    const task = await createTask(manager, {
      title: "Gọi lại khách An",
      assigneeUserId: reception.id,
      ...DUE,
      priority: "HIGH",
    });

    expect(task).toMatchObject({
      status: "NEW",
      priority: "HIGH",
      assigner: { id: manager.id },
      assignee: { id: reception.id },
      department: null,
      dueAt: new Date("2026-10-20T10:00:00.000Z"),
      actions: ["cancel", "edit", "comment"],
      comments: [],
    });
    expect(await notificationsOf(reception.id)).toEqual([
      { kind: "taskAssigned", params: { title: "Gọi lại khách An", by: "Quản lý Bảo" }, link: `/tasks/${task.id}` },
    ]);
    expect(await notificationsOf(manager.id)).toEqual([]);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: task.id } });
    expect(audit).toMatchObject({ action: "task.created", actorUserId: manager.id });
  });

  it("refuses an inactive person, one of another branch, the department Khác, and a record the user cannot see", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const branch = await createTestBranch();
    const { user: elsewhere } = await createTestUser("RECEPTIONIST", { branchIds: [branch.id] });
    const { user: gone } = await createTestUser("RECEPTIONIST");
    await prisma.user.update({ where: { id: gone.id }, data: { status: "DISABLED" } });
    const otherDepartment = await optionId("departments", "Khác");
    const hidden = await createCustomer(admin, { fullName: "Khách Q7", phone: "0909111999", branchId: branch.id });

    for (const assigneeUserId of [elsewhere.id, gone.id]) {
      await expect(createTask(manager, { title: "A", assigneeUserId, ...DUE })).rejects.toMatchObject({
        fieldErrors: { assigneeUserId: ["invalidChoice"] },
      });
    }
    await expect(
      createTask(manager, { title: "A", assigneeDepartmentId: otherDepartment, ...DUE }),
    ).rejects.toMatchObject({
      fieldErrors: { assigneeDepartmentId: ["invalidChoice"] },
    });
    await expect(
      createTask(manager, {
        title: "A",
        assigneeUserId: manager.id,
        ...DUE,
        entityType: "customer",
        entityId: hidden.id,
      }),
    ).rejects.toMatchObject({ fieldErrors: { entityId: ["invalidChoice"] } });
  });

  it("links a customer it is about, and shows the customer's code and name", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const customer = await createCustomer(manager, { fullName: "Nguyễn Văn An", phone: "0909123456" });

    const task = await createTask(manager, {
      title: "Hẹn lại",
      assigneeUserId: manager.id,
      ...DUE,
      entityType: "customer",
      entityId: customer.id,
    });

    expect(task.entity).toEqual({
      type: "customer",
      id: customer.id,
      label: `${customer.customerCode} · Nguyễn Văn An`,
    });
  });

  it("is refused without task.create", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const role = await createRole(admin, {
      name: "Chỉ xem việc",
      permissions: ["task.view"],
      dataScopes: {
        leads: "ALL",
        customers: "ALL",
        contracts: "ALL",
        schedule: "ALL",
        vouchers: "ALL",
        staff: "ALL",
        tasks: "OWN",
      },
      fieldMasks: [],
    });
    const { actor } = await createTestUser("RECEPTIONIST", { roleId: role.id });

    await expect(createTask(actor, { title: "A", assigneeUserId: admin.id, ...DUE })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("the task flow", () => {
  it("accept, start, complete: the assignee moves it, and the assigner is told", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: reception } = await createTestUser("RECEPTIONIST", { name: "Lễ tân Hồng" });
    const task = await createTask(manager, { title: "Gọi lại", assigneeUserId: reception.id, ...DUE });

    await expect(moveTask(manager, task.id, "accept")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await moveTask(reception, task.id, "accept")).toMatchObject({
      status: "ACCEPTED",
      actions: ["start", "complete", "comment"],
    });
    expect(await moveTask(reception, task.id, "start")).toMatchObject({ status: "IN_PROGRESS" });
    const done = await moveTask(reception, task.id, "complete");
    expect(done).toMatchObject({ status: "DONE", doneAt: expect.any(Date), actions: ["comment"] });
    // Repeating a move that already happened changes nothing.
    expect((await moveTask(reception, task.id, "complete")).doneAt).toEqual(done.doneAt);
    await expect(moveTask(manager, task.id, "cancel")).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });

    expect((await notificationsOf(manager.id)).map((n) => n.kind)).toEqual(["taskAccepted", "taskCompleted"]);
    const actions = await prisma.auditEvent.findMany({
      where: { entityId: task.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(["task.created", "task.accepted", "task.started", "task.completed"]);
  });

  it("only the assigner, or someone who sees every task, cancels; the assignee is told", async () => {
    const { actor: consulting } = await createTestUser("CONSULTING");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const first = await createTask(consulting, { title: "Việc 1", assigneeUserId: reception.id, ...DUE });
    const second = await createTask(consulting, { title: "Việc 2", assigneeUserId: reception.id, ...DUE });

    await expect(moveTask(reception, first.id, "cancel")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await moveTask(consulting, first.id, "cancel")).toMatchObject({ status: "CANCELLED" });
    expect(await moveTask(manager, second.id, "cancel")).toMatchObject({ status: "CANCELLED" });
    expect((await notificationsOf(reception.id)).map((n) => n.kind)).toEqual([
      "taskAssigned",
      "taskAssigned",
      "taskCancelled",
      "taskCancelled",
    ]);
  });

  it("a department's task waits for one member to accept it, also when two accept at once", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const reception = await createTestOption("departments", "Lễ tân");
    const hong = await member(manager, reception);
    const lan = await member(manager, reception);
    const outsider = (await createTestUser("RECEPTIONIST")).actor;

    const task = await createTask(manager, { title: "Kiểm tra quầy", assigneeDepartmentId: reception, ...DUE });
    expect((await notificationsOf(hong.id)).map((n) => n.kind)).toEqual(["taskAssigned"]);
    expect((await notificationsOf(lan.id)).map((n) => n.kind)).toEqual(["taskAssigned"]);
    expect((await listTasks(hong, { view: "mine" })).items.map((t) => t.id)).toEqual([task.id]);
    await expect(getTask(outsider, task.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const results = await Promise.allSettled([moveTask(hong, task.id, "accept"), moveTask(lan, task.id, "accept")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "INVALID_STATUS_TRANSITION" },
    });
    const after = await getTask(manager, task.id);
    expect(after.status).toBe("ACCEPTED");
    expect([hong.id, lan.id]).toContain(after.assignee?.id);
    // The department keeps the task in its own view.
    expect((await listTasks(lan, { view: "department" })).items.map((t) => t.id)).toEqual([task.id]);
  });

  it("the assigner edits an open task; a new assignee starts again from NEW and is told", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: hong } = await createTestUser("RECEPTIONIST");
    const { actor: lan } = await createTestUser("RECEPTIONIST");
    const task = await createTask(manager, { title: "Gọi lại", assigneeUserId: hong.id, ...DUE });
    await moveTask(hong, task.id, "accept");

    await expect(updateTask(hong, task.id, { title: "X", assigneeUserId: hong.id, ...DUE })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const moved = await updateTask(manager, task.id, {
      title: "Gọi lại gấp",
      assigneeUserId: lan.id,
      dueDate: "21/10/2026",
      dueTime: "09:00",
    });

    expect(moved).toMatchObject({ title: "Gọi lại gấp", status: "NEW", assignee: { id: lan.id }, acceptedAt: null });
    expect((await notificationsOf(lan.id)).map((n) => n.kind)).toEqual(["taskAssigned"]);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: task.id, action: "task.updated" } });
    expect(audit).toMatchObject({
      before: { title: "Gọi lại", assigneeUserId: hong.id },
      after: { title: "Gọi lại gấp", assigneeUserId: lan.id },
    });
  });
});

describe("seeing tasks (data scope tasks)", () => {
  it("a user with only-mine scope sees what they gave and got; a manager sees the branch's; other branches are hidden", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: hong } = await createTestUser("RECEPTIONIST");
    const { actor: lan } = await createTestUser("RECEPTIONIST");
    const branch = await createTestBranch();
    const toHong = await createTask(manager, { title: "Cho Hồng", assigneeUserId: hong.id, ...DUE });
    const fromHong = await createTask(hong, { title: "Hồng giao", assigneeUserId: manager.id, ...DUE });
    const toLan = await createTask(manager, { title: "Cho Lan", assigneeUserId: lan.id, ...DUE });
    await createTask(admin, { title: "Chi nhánh khác", assigneeUserId: admin.id, ...DUE, branchId: branch.id });

    expect((await listTasks(hong, { view: "mine" })).items.map((t) => t.id)).toEqual([toHong.id]);
    expect((await listTasks(hong, { view: "assigned" })).items.map((t) => t.id)).toEqual([fromHong.id]);
    await expect(getTask(hong, toLan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listTasks(hong, { view: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listTasks(manager, { view: "all" })).total).toBe(3);
    expect((await listTasks(admin, { view: "all" })).total).toBe(4);
  });

  it("counts my open and overdue tasks, and lists overdue ones on their own", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: hong } = await createTestUser("RECEPTIONIST");
    const late = await createTask(manager, {
      title: "Trễ",
      assigneeUserId: hong.id,
      dueDate: "01/01/2020",
      dueTime: "09:00",
    });
    await createTask(manager, { title: "Còn hạn", assigneeUserId: hong.id, dueDate: "01/01/2099", dueTime: "09:00" });

    expect(await taskSummary(hong)).toEqual({ open: 2, overdue: 1 });
    const overdue = await listTasks(hong, { overdueOnly: "true" });
    expect(overdue.items.map((t) => [t.id, t.overdue])).toEqual([[late.id, true]]);
  });

  it("offers active people of the user's branches and the active departments", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { name: "Quản lý" });
    const department = await createTestOption("departments", "Kinh doanh");
    await createTestOption("departments", "Đã giải thể", false);
    const sale = await member(manager, department);

    const assignees = await taskAssignees(manager);

    expect(assignees.departments.map((d) => d.labelVi)).toEqual(["Kinh doanh"]);
    expect(assignees.users.find((user) => user.id === sale.id)).toMatchObject({ department: { id: department } });
  });
});

describe("comments", () => {
  it("tells the people mentioned, and the assigner and assignee, never the author", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { name: "Quản lý" });
    const { actor: hong } = await createTestUser("RECEPTIONIST", { name: "Hồng" });
    const { actor: master } = await createTestUser("MASTER", { name: "Master Tùng" });
    const task = await createTask(manager, { title: "Gọi lại", assigneeUserId: hong.id, ...DUE });

    const commented = await addComment(hong, task.id, { body: "Khách hẹn chiều mai", mentions: [master.id] });

    expect(commented.comments).toEqual([
      expect.objectContaining({
        author: { id: hong.id, name: "Hồng" },
        body: "Khách hẹn chiều mai",
        mentions: [{ id: master.id, name: "Master Tùng" }],
      }),
    ]);
    expect((await notificationsOf(master.id)).map((n) => n.kind)).toEqual(["taskMentioned"]);
    expect((await notificationsOf(manager.id)).map((n) => [n.kind, (n.params as { by: string }).by])).toEqual([
      ["taskCommented", "Hồng"],
    ]);
    expect((await notificationsOf(hong.id)).map((n) => n.kind)).toEqual(["taskAssigned"]);
  });

  it("refuses mentioning someone who does not work in the branch", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const branch = await createTestBranch();
    const { user: elsewhere } = await createTestUser("RECEPTIONIST", { branchIds: [branch.id] });
    const task = await createTask(manager, { title: "A", assigneeUserId: manager.id, ...DUE });

    await expect(addComment(manager, task.id, { body: "Xem giúp", mentions: [elsewhere.id] })).rejects.toMatchObject({
      fieldErrors: { mentions: ["invalidChoice"] },
    });
  });
});

describe("reminders (worker, T-059)", () => {
  it("reminds the assignee before the deadline and tells both sides once it passes, each once", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: hong } = await createTestUser("RECEPTIONIST");
    // 20/10/2026 17:00 in Ho Chi Minh is 10:00 UTC.
    const task = await createTask(manager, { title: "Gọi lại", assigneeUserId: hong.id, ...DUE });
    const done = await createTask(manager, { title: "Đã xong", assigneeUserId: hong.id, ...DUE });
    await moveTask(hong, done.id, "accept");
    await moveTask(hong, done.id, "complete");

    // 25 hours before: nothing yet. 23 hours before: the reminder, once.
    expect(await remindTasks(new Date("2026-10-19T09:00:00Z"))).toEqual({ dueSoon: 0, overdue: 0 });
    expect(await remindTasks(new Date("2026-10-19T11:00:00Z"))).toEqual({ dueSoon: 1, overdue: 0 });
    expect(await remindTasks(new Date("2026-10-19T12:00:00Z"))).toEqual({ dueSoon: 0, overdue: 0 });
    // After the deadline: the assignee and the assigner, once.
    expect(await remindTasks(new Date("2026-10-20T10:01:00Z"))).toEqual({ dueSoon: 0, overdue: 1 });
    expect(await remindTasks(new Date("2026-10-20T11:00:00Z"))).toEqual({ dueSoon: 0, overdue: 0 });

    expect(await notificationsOf(hong.id)).toEqual([
      expect.objectContaining({ kind: "taskAssigned" }),
      expect.objectContaining({ kind: "taskAssigned" }),
      { kind: "taskDueSoon", params: { title: "Gọi lại", due: "20/10/2026 17:00" }, link: `/tasks/${task.id}` },
      { kind: "taskOverdue", params: { title: "Gọi lại", due: "20/10/2026 17:00" }, link: `/tasks/${task.id}` },
    ]);
    expect((await notificationsOf(manager.id)).map((n) => n.kind)).toEqual([
      "taskAccepted",
      "taskCompleted",
      "taskOverdue",
    ]);
  });

  it("the reminder time is a parameter", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await createTask(manager, { title: "Gọi lại", assigneeUserId: manager.id, ...DUE });
    await prisma.systemParameter.create({ data: { key: "taskDueSoonHours", value: "2" } });

    expect(await remindTasks(new Date("2026-10-20T07:00:00Z"))).toEqual({ dueSoon: 0, overdue: 0 });
    expect(await remindTasks(new Date("2026-10-20T08:30:00Z"))).toEqual({ dueSoon: 1, overdue: 0 });
  });
});
