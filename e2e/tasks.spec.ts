import type { APIRequestContext, Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createCustomerViaApi } from "./support/data";
import { E2E_USERS } from "./support/db";
import { fill, labels } from "./support/labels";

// Giao việc and notifications (brief §8.2, FR-PLT-009; docs/13 E2E-115).
const k = labels.tasks;
const status = labels.status.task;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

async function idOf(api: APIRequestContext): Promise<string> {
  return (await (await api.get("/api/v1/me")).json()).id;
}

async function giveTaskViaApi(
  api: APIRequestContext,
  data: { title: string; assigneeUserId: string; dueDate?: string; dueTime?: string },
) {
  const response = await api.post("/api/v1/tasks", { data: { dueDate: "20/06/2030", dueTime: "17:00", ...data } });
  if (response.status() !== 201) throw new Error(`Task setup failed: ${response.status()} ${await response.text()}`);
  return (await response.json()) as { id: string; title: string };
}

test.describe("tasks as a manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-115: a manager gives a task, the receptionist accepts it, and they talk in the comments", async ({
    page,
    apiAs,
    testTag,
    tasksPage,
    taskPage,
  }) => {
    const title = `Gọi lại khách ${testTag}`;

    await tasksPage.goto("?view=assigned");
    const form = await tasksPage.openCreate();
    await form.fill({
      title,
      assignee: E2E_USERS.RECEPTIONIST.name,
      dueDate: "20/06/2030",
      dueTime: "09:30",
      priority: labels.status.taskPriority.HIGH,
    });
    await form.save();

    await expect(toasts(page).getByText(k.created)).toBeVisible();
    await expect(taskPage.heading(title)).toBeVisible();
    await expect(taskPage.detail(k.fields.status)).toHaveText(status.NEW);
    await expect(taskPage.detail(k.fields.dueAt)).toContainText("20/06/2030 09:30");
    const taskId = new URL(page.url()).pathname.split("/").pop()!;

    // The receptionist was told, and accepts.
    const reception = await apiAs("RECEPTIONIST");
    const notifications = (await (await reception.get("/api/v1/notifications?pageSize=100")).json()) as {
      items: { kind: string; params: { title: string } }[];
    };
    expect(notifications.items.filter((n) => n.params.title === title).map((n) => n.kind)).toEqual(["taskAssigned"]);
    expect((await reception.post(`/api/v1/tasks/${taskId}/accept`)).status()).toBe(200);

    await page.reload();
    await expect(taskPage.detail(k.fields.status)).toHaveText(status.ACCEPTED);
    await taskPage.comment(`Nhờ gọi trước 9 giờ ${testTag}`, E2E_USERS.RECEPTIONIST.name);
    await expect(toasts(page).getByText(k.commented)).toBeVisible();
    await expect(taskPage.comments).toContainText(`Nhờ gọi trước 9 giờ ${testTag}`);
    await expect(taskPage.comments).toContainText(fill(k.mentioned, { names: E2E_USERS.RECEPTIONIST.name }));

    await tasksPage.goto("?view=assigned");
    await expect(tasksPage.row(k.views.assigned, title)).toContainText(status.ACCEPTED);
  });

  test("a task given from a customer's page is about that customer; cancelling asks first", async ({
    page,
    apiAs,
    testTag,
    taskPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const title = `Hẹn lại khách ${testTag}`;

    await page.goto(`/customers/${customer.id}`);
    await page.getByRole("main").getByRole("button", { name: k.create, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: k.create });
    await expect(dialog).toContainText(
      fill(k.createAbout, { label: `${customer.customerCode} · ${customer.fullName}` }),
    );
    await dialog.getByLabel(k.fields.title, { exact: true }).fill(title);
    await dialog.getByRole("combobox", { name: k.fields.assignee, exact: true }).click();
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: E2E_USERS.RECEPTIONIST.name })
      .first()
      .click();
    await dialog.getByLabel(k.fields.dueDate, { exact: true }).fill("20/06/2030");
    await dialog.getByRole("button", { name: labels.common.save }).click();

    await expect(taskPage.heading(title)).toBeVisible();
    await expect(taskPage.detail(k.fields.entity)).toContainText(customer.customerCode);

    await taskPage.move(k.actions.cancel).click();
    await page.getByRole("alertdialog").getByRole("button", { name: k.actions.cancel, exact: true }).click();
    await expect(taskPage.detail(k.fields.status)).toHaveText(status.CANCELLED);
    await expect(taskPage.move(k.actions.cancel)).toHaveCount(0);
  });
});

test.describe("tasks as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("the bell shows a new task; the receptionist opens it, accepts, works, and completes it, and the manager is told", async ({
    page,
    apiAs,
    testTag,
    notificationsPage,
    taskPage,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const task = await giveTaskViaApi(manager, {
      title: `Kiểm tra quầy ${testTag}`,
      assigneeUserId: await idOf(await apiAs("RECEPTIONIST")),
    });

    await page.goto("/dashboard");
    const menu = await notificationsPage.openBell();
    await menu
      .getByRole("menuitem")
      .filter({
        hasText: fill(labels.notifications.kinds.taskAssigned, {
          by: E2E_USERS.FITNESS_MANAGER.name,
          title: task.title,
        }),
      })
      .click();

    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
    await taskPage.move(k.actions.accept).click();
    await expect(taskPage.detail(k.fields.status)).toHaveText(status.ACCEPTED);
    await taskPage.move(k.actions.start).click();
    await expect(taskPage.detail(k.fields.status)).toHaveText(status.IN_PROGRESS);
    await taskPage.move(k.actions.complete).click();
    await expect(taskPage.detail(k.fields.status)).toHaveText(status.DONE);
    // The receptionist did not give it, so cannot cancel or edit it.
    await expect(taskPage.move(k.actions.cancel)).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("button", { name: k.edit, exact: true })).toHaveCount(0);

    const told = (await (await manager.get("/api/v1/notifications?pageSize=100")).json()) as {
      items: { kind: string; params: { title: string } }[];
    };
    expect(
      told.items
        .filter((n) => n.params.title === task.title)
        .map((n) => n.kind)
        .sort(),
    ).toEqual(["taskAccepted", "taskCompleted"]);

    // Opening it from the bell read it.
    await notificationsPage.goto();
    await expect(notificationsPage.list.getByRole("button").filter({ hasText: task.title })).not.toContainText(
      labels.notifications.unread,
    );
  });

  test("an overdue task is marked and has its own filter", async ({ apiAs, testTag, tasksPage }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const me = await idOf(await apiAs("RECEPTIONIST"));
    await giveTaskViaApi(manager, {
      title: `Trễ hạn ${testTag}`,
      assigneeUserId: me,
      dueDate: "01/01/2020",
      dueTime: "09:00",
    });
    await giveTaskViaApi(manager, { title: `Còn hạn ${testTag}`, assigneeUserId: me });

    await tasksPage.goto(`?view=mine&q=${testTag}`);
    await expect(tasksPage.row(k.views.mine, `Trễ hạn ${testTag}`)).toContainText(k.overdue);
    await expect(tasksPage.row(k.views.mine, `Còn hạn ${testTag}`)).not.toContainText(k.overdue);

    await tasksPage.goto(`?view=mine&q=${testTag}&deadline=overdue`);
    await expect(tasksPage.table(k.views.mine).getByRole("row").filter({ hasText: testTag })).toHaveCount(1);
  });
});
