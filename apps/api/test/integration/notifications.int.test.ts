import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { remindOverdueApprovals } from "../../src/platform/approvals/approval.engine.js";
import { approveRequest } from "../../src/modules/approvals/approval.service.js";
import { createCustomer, updateCustomer } from "../../src/modules/customers/customer.service.js";
import {
  listNotifications,
  markAllRead,
  markRead,
  notificationSummary,
} from "../../src/platform/notifications/notification.service.js";
import { createTask } from "../../src/modules/tasks/task.service.js";
import { startJobs } from "../../src/jobs.js";
import { resetDatabase } from "../support/database.js";
import { createTestBranch, createTestUser } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const kindsOf = async (userId: string) =>
  (
    await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { kind: true } })
  ).map((n) => n.kind);

describe("notifications of the signed-in user (FR-PLT-009)", () => {
  it("lists only one's own, counts the unread, and marks one or all read", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: hong } = await createTestUser("RECEPTIONIST");
    for (const title of ["Việc 1", "Việc 2"]) {
      await createTask(manager, { title, assigneeUserId: hong.id, dueDate: "20/10/2026", dueTime: "17:00" });
    }

    const page = await listNotifications(hong, {});
    expect(page.items.map((n) => n.params.title)).toEqual(["Việc 2", "Việc 1"]);
    expect(await listNotifications(manager, {})).toMatchObject({ total: 0 });
    expect(await notificationSummary(hong)).toEqual({ unread: 2 });

    await expect(markRead(manager, page.items[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(markRead(hong, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await markRead(hong, page.items[0].id);
    expect(await notificationSummary(hong)).toEqual({ unread: 1 });
    expect((await listNotifications(hong, { unreadOnly: "true" })).items.map((n) => n.params.title)).toEqual([
      "Việc 1",
    ]);
    await markAllRead(hong);
    expect(await notificationSummary(hong)).toEqual({ unread: 0 });
  });
});

describe("approval notifications (D-018, A-037)", () => {
  async function identityEdit() {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: admin } = await createTestUser("ADMIN");
    const branch = await createTestBranch();
    const { actor: managerElsewhere } = await createTestUser("FITNESS_MANAGER", { branchIds: [branch.id] });
    const customer = await createCustomer(reception, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const { approval } = await updateCustomer(reception, customer.id, {
      fullName: "Nguyễn Văn An",
      phone: "0911222333",
    });
    return { reception, manager, admin, managerElsewhere, approval: approval! };
  }

  it("tells the approvers of the branch when a request arrives, and the submitter when it is decided", async () => {
    const { reception, manager, admin, managerElsewhere, approval } = await identityEdit();

    // customer.identity is approved by the Fitness Manager (09_RBAC.md).
    expect(await kindsOf(manager.id)).toEqual(["approvalSubmitted"]);
    expect(await kindsOf(admin.id)).toEqual([]);
    expect(await kindsOf(managerElsewhere.id)).toEqual([]);
    await approveRequest(manager, approval.id);
    const decided = await prisma.notification.findFirstOrThrow({ where: { userId: reception.id } });
    expect(decided).toMatchObject({
      kind: "approvalDecided",
      params: { status: "APPROVED" },
      link: "/approvals?view=mine",
    });
  });

  it("reminds the approvers and tells their superiors once a request is overdue, once", async () => {
    const { reception, manager, admin, approval } = await identityEdit();
    const submittedAt = (
      await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })
    ).submittedAt.getTime();

    expect(await remindOverdueApprovals(new Date(submittedAt + 23 * 3_600_000))).toBe(0);
    expect(await remindOverdueApprovals(new Date(submittedAt + 25 * 3_600_000))).toBe(1);
    expect(await remindOverdueApprovals(new Date(submittedAt + 26 * 3_600_000))).toBe(0);

    expect(await kindsOf(manager.id)).toEqual(["approvalSubmitted", "approvalOverdue"]);
    // Until the business names superiors (OQ-031), they are the matrix managers (A-047).
    expect(await kindsOf(admin.id)).toEqual(["approvalOverdue"]);
    expect(await kindsOf(reception.id)).toEqual([]);
  });
});

describe("the job runner (T-059)", () => {
  it("starts pg-boss with the reminders queue and stops cleanly", async () => {
    const jobs = await startJobs();
    try {
      const [queue] = await prisma.$queryRaw<
        { name: string }[]
      >`SELECT name FROM pgboss.queue WHERE name = 'reminders'`;
      expect(queue?.name).toBe("reminders");
    } finally {
      await jobs.stop();
    }
  });
});
