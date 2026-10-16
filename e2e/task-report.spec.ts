import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";
import { readDownload } from "./support/xlsx";

// The tasks report and the revenue by year of the overview (brief §9, FR-TASK-006; M9.1, docs/13 E2E-178). A task counts in
// the period its deadline falls in, so the specs' tasks (all due in June 2030) give a period of their own.
const t = labels.taskReport;

test.describe("as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-178: the tasks report counts what was given to a person, and exports to Excel", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const reception = await apiAs("RECEPTIONIST");
    const me = (await (await reception.get("/api/v1/me")).json()) as { id: string; name: string };
    const title = `Việc báo cáo ${testTag}`;
    const created = await manager.post("/api/v1/tasks", {
      data: { title, assigneeUserId: me.id, dueDate: "20/06/2030", dueTime: "17:00" },
    });
    expect(created.status()).toBe(201);

    await page.goto("/reports/tasks?from=01/06/2030&to=30/06/2030");
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
    // Open and not yet due in 2030: assigned, not overdue.
    const people = page.getByRole("region", { name: t.byPerson });
    const row = people.getByRole("row").filter({ hasText: me.name });
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell").nth(2)).not.toHaveText("0");

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: labels.common.exportExcel }).click();
    const file = await readDownload(await downloading);
    expect(file.name).toBe(t.title);
    expect(file.header).toContain(t.fields.person);
    expect(file.rows.some((fileRow) => fileRow.includes(me.name))).toBe(true);
  });

  test("a period with no deadline shows the empty message", async ({ page }) => {
    await page.goto("/reports/tasks?from=01/01/2015&to=31/01/2015");
    await expect(page.getByText(t.empty)).toBeVisible();
  });

  test("the overview shows the revenue by year", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("region", { name: labels.overview.byYear })).toBeVisible();
  });
});

test.describe("as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("the tasks report is not for everyone: no menu entry, and the page says so", async ({ page }) => {
    await page.goto("/reports/tasks");
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toHaveCount(0);
    await expect(page.getByRole("link", { name: labels.nav.taskReport })).toHaveCount(0);
  });
});
