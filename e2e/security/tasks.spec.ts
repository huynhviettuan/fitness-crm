// OWASP A01 (access control, data scope, IDOR, mass assignment) and A10 (input errors)
// for the task and notification routes of M1 slice 7 (brief §8.2, FR-PLT-009). Route-
// level 401s and 403s are covered by the route inventory in access-control.spec.ts.
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const DUE = { dueDate: "20/06/2030", dueTime: "17:00" };

async function idOf(api: APIRequestContext): Promise<string> {
  return (await (await api.get("/api/v1/me")).json()).id;
}

test.describe("A01 tasks", () => {
  for (const role of ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "PT", "ACCOUNTANT", "CONSULTING"] as Role[]) {
    test(`${role} can give a task (09_RBAC.md)`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);
      const response = await api.post("/api/v1/tasks", { data: { title: `Việc ${testTag}`, assigneeUserId: await idOf(api), ...DUE } });
      expect(response.status()).toBe(201);
    });
  }

  test("a task between others is not found, cannot be accepted, and 'all' is refused without the all-tasks scope", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const pt = await apiAs("PT");
    const reception = await apiAs("RECEPTIONIST");
    const task = await (await manager.post("/api/v1/tasks", { data: { title: `Riêng ${testTag}`, assigneeUserId: await idOf(pt), ...DUE } })).json();

    expect((await reception.get(`/api/v1/tasks/${task.id}`)).status()).toBe(404);
    for (const action of ["accept", "start", "complete", "cancel"]) {
      expect((await reception.post(`/api/v1/tasks/${task.id}/${action}`)).status(), action).toBe(404);
    }
    expect((await reception.post(`/api/v1/tasks/${task.id}/comments`, { data: { body: "X" } })).status()).toBe(404);
    // The assignee sees it but may not cancel or edit what they did not give.
    expect((await pt.post(`/api/v1/tasks/${task.id}/cancel`)).status()).toBe(403);
    expect((await pt.patch(`/api/v1/tasks/${task.id}`, { data: { title: "X", assigneeUserId: await idOf(pt), ...DUE } })).status()).toBe(403);
    expect((await pt.get("/api/v1/tasks?view=all")).status()).toBe(403);
    expect((await manager.get("/api/v1/tasks?view=all")).status()).toBe(200);
  });

  test("status, assigner, and timestamps cannot be set by the client (mass assignment)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const manager = await apiAs("FITNESS_MANAGER");

    const response = await reception.post("/api/v1/tasks", {
      data: {
        title: `Giả mạo ${testTag}`,
        assigneeUserId: await idOf(reception),
        ...DUE,
        status: "DONE",
        assignerId: await idOf(manager),
        doneAt: new Date().toISOString(),
        id: randomUUID(),
      },
    });

    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ status: "NEW", assigner: { id: await idOf(reception) }, doneAt: null });
  });
});

test.describe("A01 notifications", () => {
  test("a user reads and marks only their own notifications", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const reception = await apiAs("RECEPTIONIST");
    await manager.post("/api/v1/tasks", { data: { title: `Báo ${testTag}`, assigneeUserId: await idOf(reception), ...DUE } });
    const theirs = (await (await reception.get("/api/v1/notifications?pageSize=100")).json()) as { items: { id: string; params: { title: string } }[] };
    const notification = theirs.items.find((n) => n.params.title === `Báo ${testTag}`)!;

    const managersView = (await (await manager.get("/api/v1/notifications?pageSize=100")).json()) as { items: { id: string }[] };
    expect(managersView.items.map((n) => n.id)).not.toContain(notification.id);
    expect((await manager.post(`/api/v1/notifications/${notification.id}/read`)).status()).toBe(404);
    expect((await reception.post(`/api/v1/notifications/${notification.id}/read`)).status()).toBe(204);
    expect((await reception.post(`/api/v1/notifications/${randomUUID()}/read`)).status()).toBe(404);
  });
});

test.describe("A10 task input errors", () => {
  test("invalid fields, two assignees, an empty comment, and an unknown mention are 400; unknown ids are 404", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const me = await idOf(manager);

    const invalid = await manager.post("/api/v1/tasks", { data: { title: "", assigneeUserId: me, dueDate: "31/02/2030", dueTime: "25:00", priority: "URGENT" } });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).details.fieldErrors).toMatchObject({
      title: ["required"],
      dueDate: ["invalidDate"],
      dueTime: ["invalidTime"],
      priority: ["invalidChoice"],
    });
    const both = await manager.post("/api/v1/tasks", { data: { title: `A ${testTag}`, assigneeUserId: me, assigneeDepartmentId: randomUUID(), ...DUE } });
    expect(both.status()).toBe(400);

    const task = await (await manager.post("/api/v1/tasks", { data: { title: `Lỗi ${testTag}`, assigneeUserId: me, ...DUE } })).json();
    expect((await manager.post(`/api/v1/tasks/${task.id}/comments`, { data: { body: " " } })).status()).toBe(400);
    const mention = await manager.post(`/api/v1/tasks/${task.id}/comments`, { data: { body: "Xem giúp", mentions: [randomUUID()] } });
    expect(mention.status()).toBe(400);
    expect((await mention.json()).details.fieldErrors).toMatchObject({ mentions: ["invalidChoice"] });
    for (const id of [randomUUID(), "not-a-uuid"]) {
      expect((await manager.get(`/api/v1/tasks/${id}`)).status()).toBe(404);
      expect((await manager.post(`/api/v1/tasks/${id}/accept`)).status()).toBe(404);
    }
    expect((await manager.get("/api/v1/tasks?view=everyone")).status()).toBe(400);
  });
});
