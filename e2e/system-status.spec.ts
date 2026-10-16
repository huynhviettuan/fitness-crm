import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";

// E2E-187: the System status page (A-321). The E2E API runs without its jobs (RUN_JOBS=false), without a backup key and
// with emails only recorded, so the page shows exactly that; the states themselves are covered by system-status.int.test.ts.
const system = labels.system;

test.describe("the System status page as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-187: Admin opens it from the sidebar and sees the jobs, the backups, the emails and the settings", async ({
    page,
    shell,
  }) => {
    await page.goto("/dashboard");
    await shell.expandNav();
    await shell.navLink(labels.nav.systemStatus).click();

    await expect(shell.pageHeading(system.title)).toBeVisible();
    for (const section of Object.values(system.sections)) {
      await expect(shell.main.getByText(section, { exact: true })).toBeVisible();
    }
    const jobs = shell.main.getByRole("list", { name: system.sections.jobs });
    await expect(jobs.getByRole("listitem")).toHaveCount(3);
    await expect(jobs.getByRole("listitem").filter({ hasText: system.jobs.backup })).toContainText(system.state.off);
    await expect(shell.main).toContainText(system.backup.offHint);
    await expect(shell.main).toContainText(system.emails.recordHint);
    await expect(shell.main.getByRole("status")).toContainText(system.checkedAt);
  });
});

test.describe("the System status page as reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("is not in the sidebar and is refused when opened directly", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await shell.expandNav();
    await expect(shell.navLink(labels.nav.systemStatus)).toHaveCount(0);

    await page.goto("/admin/system");
    await expect(shell.main.getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
  });
});
