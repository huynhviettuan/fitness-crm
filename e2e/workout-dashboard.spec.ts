import { expect, signedInAs, test } from "./fixtures";
import { fill, labels } from "./support/labels";
import { loggedSession, sessionsWithPlan } from "./support/workouts";

// The weekly workout dashboard and a customer's progress (brief §7.5, §9; FR-WKO-005; AC-20, AC-21; docs/13 E2E-173).
const d = labels.workoutDashboard;
const pr = labels.workoutProgress;

test.describe("the weekly dashboard", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-173: the shares of Flag and Action, the customers behind them, and the customer's progress", async ({
    page,
    apiAs,
    testTag,
    customerDetailPage,
  }) => {
    const { customer, day, bookings } = await sessionsWithPlan(apiAs, testTag, 2);
    // One session with a Stress Flag and the Action Giảm tải on its first set, one with the defaults only.
    const stressed = await loggedSession(apiAs, bookings[0], { flag: "STRESS", action: "REDUCE" });
    await loggedSession(apiAs, bookings[1], { flag: "NORMAL", action: "NONE" });

    await page.goto(`/reports/workouts?week=${encodeURIComponent(day.date)}`);
    await expect(page.getByRole("heading", { level: 1, name: d.title })).toBeVisible();
    const flags = page.getByRole("region", { name: d.flags, exact: true });
    const actions = page.getByRole("region", { name: d.actions, exact: true });
    await expect(flags.getByRole("row", { name: /Normal/ })).toBeVisible();
    await expect(actions.getByRole("row", { name: /None/ })).toBeVisible();
    // The escalations waiting link to their list.
    await expect(page.getByText(d.totals.escalations, { exact: true })).toBeVisible();

    // A share opens the sets behind it: ours is among the Stress sets, and its link opens the log.
    await flags
      .getByRole("row", { name: /Stress/ })
      .getByRole("link")
      .click();
    const drill = page.getByRole("region", { name: d.drill, exact: true });
    const row = drill.getByRole("row").filter({ hasText: customer.fullName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Giảm tải");
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/workouts/logs/${stressed}`));

    // The customers with a Flag beyond Normal include ours.
    await page.goto(`/reports/workouts?week=${encodeURIComponent(day.date)}&kind=nonNormal`);
    await expect(
      page.getByRole("region", { name: d.drill, exact: true }).getByRole("row").filter({ hasText: customer.fullName }),
    ).toHaveCount(1);

    // In the customer's profile: two of two planned sessions done, the stage now, the scales and the Flag history.
    await page.goto(`/customers/${customer.id}`);
    await customerDetailPage.openTab(labels.customers.tabs.plans);
    const panel = customerDetailPage.tabPanel(labels.customers.tabs.plans);
    const summary = panel.getByRole("region", { name: pr.summary, exact: true });
    await expect(summary).toContainText(fill(pr.doneOfPlanned, { done: 2, planned: 2 }));
    await expect(summary).toContainText(`Rehab ${testTag}`);
    const sessions = panel.getByRole("table", { name: pr.sessions, exact: true });
    await expect(sessions.getByRole("row")).toHaveCount(3);
    await expect(sessions.getByRole("row").nth(1)).toContainText("6");
    await expect(sessions.getByRole("row").nth(1)).toContainText("8");
    const history = panel.getByRole("region", { name: pr.history, exact: true });
    await expect(history.getByRole("row")).toHaveCount(2);
    await expect(history).toContainText("Stress");
    await expect(history).toContainText("Giảm tải");
    await expect(panel.getByRole("region", { name: `Squat ${testTag}`, exact: true })).toBeVisible();
  });

  test("shows an empty week without dividing by nothing", async ({ page }) => {
    await page.goto("/reports/workouts?week=01%2F01%2F2040");
    await expect(page.getByRole("heading", { level: 1, name: d.title })).toBeVisible();
    await expect(
      page.getByRole("region", { name: d.flags, exact: true }).getByRole("row", { name: /Normal/ }),
    ).toContainText(fill(d.percentValue, { value: 0 }));
  });
});

test.describe("who sees the dashboard", () => {
  for (const role of ["RECEPTIONIST", "PT"] as const) {
    test.describe(role, () => {
      test.use(signedInAs(role));

      test("has no dashboard", async ({ page, apiAs }) => {
        await page.goto("/reports/workouts");
        await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
        expect((await (await apiAs(role)).get("/api/v1/reports/workouts")).status()).toBe(403);
      });
    });
  }
});
