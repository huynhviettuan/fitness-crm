import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";
import { sessionsWithPlan } from "./support/workouts";

// Escalation (brief §7.4; FR-WKO-004; AC-21; docs/13 E2E-172): "Dừng + Escalation" in the log tells the manager and the
// Master at once, waits in the list and in Giao việc, and is closed by marking it seen with a direction.
const w = labels.workoutLogs;
const e = labels.workoutEscalations;

test.describe("a coach stops a session", () => {
  test.use({ ...signedInAs("PT"), viewport: { width: 375, height: 812 } });

  test("@smoke E2E-172: the stop tells the manager, waits in the list and in Giao việc, and the manager closes it with a direction", async ({
    page,
    browser,
    apiAs,
    testTag,
    workoutLogPage: log,
  }) => {
    const { customer, catalog, bookings } = await sessionsWithPlan(apiAs, testTag, 1);
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);
    const opened = await (await apiAs("PT")).post("/api/v1/workout/logs", { data: { bookingId: bookings[0] } });
    await log.goto(((await opened.json()) as { id: string }).id);

    // The coach stops at the second set of the Squat, with the Flag and a note.
    await log.pick(log.choice(catalog.squat, 2, w.fields.flag), "Stress");
    await log.pick(log.choice(catalog.squat, 2, w.fields.action), "Dừng + Escalation");
    await log
      .set(catalog.squat, 2)
      .getByLabel(`${labels.workoutPlans.place.sets.replace("{n}", "2")} · ${w.fields.setNote}`)
      .fill("Đau lưng, dừng tập");
    await log.save();
    await expect(notice(w.saved)).toBeVisible();
    await expect(log.set(catalog.squat, 2).getByRole("status")).toContainText(w.escalationWaiting);
    // Saving again does not send it twice.
    await log.save();
    await expect(notice(w.saved).first()).toBeVisible();

    // The manager is told, with a link to the session.
    const manager = await apiAs("FITNESS_MANAGER");
    const told = (await (await manager.get("/api/v1/notifications?pageSize=100")).json()) as {
      items: { kind: string; link: string | null; params: Record<string, string> }[];
    };
    const mine = told.items.filter(
      (item) => item.kind === "workoutEscalation" && item.params.customer === customer.fullName,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.link).toMatch(/^\/workouts\/logs\//);
    expect(mine[0]!.params).toMatchObject({ exercise: catalog.squat, flag: "Stress", note: "Đau lưng, dừng tập" });

    // It waits as a task in Giao việc.
    const admin = await apiAs("ADMIN");
    const tasks = async () =>
      (
        (await (await admin.get("/api/v1/tasks?view=all&pageSize=100")).json()) as {
          items: { title: string; status: string; entity: { type: string } | null }[];
        }
      ).items.filter((task) => task.title.includes(customer.fullName) && task.entity?.type === "workoutLog");
    expect(await tasks()).toMatchObject([{ status: "NEW" }]);

    // The manager sees it waiting, and marks it seen with a direction.
    const context = await browser.newContext({
      ...signedInAs("FITNESS_MANAGER"),
      baseURL: test.info().project.use.baseURL,
    });
    const managerPage = await context.newPage();
    try {
      await managerPage.goto("/workouts/escalations?status=WAITING");
      const row = managerPage.getByRole("row").filter({ hasText: customer.fullName });
      await expect(row).toContainText(e.status.WAITING);
      await expect(row).toContainText("Đau lưng, dừng tập");
      await row.getByRole("button", { name: e.markSeen, exact: true }).click();
      const dialog = managerPage.getByRole("dialog", { name: e.markSeen });
      // A direction is required.
      await dialog.getByRole("button", { name: e.confirmSeen, exact: true }).click();
      await expect(dialog.getByText(labels.validation.required)).toBeVisible();
      await dialog.getByLabel(e.fields.direction, { exact: true }).fill("Nghỉ buổi này, khám lại lưng");
      await dialog.getByRole("button", { name: e.confirmSeen, exact: true }).click();
      await expect(managerPage.getByRole("row").filter({ hasText: customer.fullName })).toHaveCount(0);
      await managerPage.goto("/workouts/escalations?status=SEEN");
      await expect(managerPage.getByRole("row").filter({ hasText: customer.fullName })).toContainText(
        "Nghỉ buổi này, khám lại lưng",
      );
    } finally {
      await context.close();
    }

    // The task is done, and the coach sees the direction beside the set.
    expect(await tasks()).toMatchObject([{ status: "DONE" }]);
    await page.reload();
    await expect(log.set(catalog.squat, 2).getByRole("status")).toContainText("Nghỉ buổi này, khám lại lưng");
  });
});

test.describe("who sees escalations", () => {
  test.describe("reception", () => {
    test.use(signedInAs("RECEPTIONIST"));

    test("has none", async ({ page, apiAs }) => {
      await page.goto("/workouts/escalations");
      await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
      expect((await (await apiAs("RECEPTIONIST")).get("/api/v1/workout/escalations")).status()).toBe(403);
    });
  });
});
