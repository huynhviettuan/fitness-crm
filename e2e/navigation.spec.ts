import { expect, signedInAs, test } from "./fixtures";
import { labels } from "./support/labels";

const groups = labels.nav.groups;

// E2E-147 to E2E-150: the sidebar groups its items and opens only the group of the page you are on (A-105).
test.describe("the sidebar as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-147: groups start closed on the dashboard and the group of the current page is open", async ({
    page,
    shell,
  }) => {
    await page.goto("/dashboard");
    await expect(shell.pageHeading(labels.dashboard.title)).toBeVisible();

    await expect(shell.groupButton(groups.leads)).toHaveAttribute("aria-expanded", "false");
    await expect(shell.navLink(labels.nav.leadsToday)).toHaveCount(0);

    await page.goto("/leads/today");

    await expect(shell.groupButton(groups.leads)).toHaveAttribute("aria-expanded", "true");
    await expect(shell.navLink(labels.nav.leadsToday)).toHaveAttribute("aria-current", "page");
    await expect(shell.navLink(labels.nav.leads)).not.toHaveAttribute("aria-current", "page");
    await expect(shell.groupButton(groups.customers)).toHaveAttribute("aria-expanded", "false");
  });

  test("E2E-148: a group opened by hand is still open after a reload", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await expect(shell.pageHeading(labels.dashboard.title)).toBeVisible();

    await shell.groupButton(groups.people).click();
    await expect(shell.navLink(labels.nav.users)).toBeVisible();
    await page.reload();

    await expect(shell.groupButton(groups.people)).toHaveAttribute("aria-expanded", "true");
    await expect(shell.navLink(labels.nav.users)).toBeVisible();
    // A group never opened stays closed.
    await expect(shell.groupButton(groups.monitoring)).toHaveAttribute("aria-expanded", "false");
  });

  test("E2E-149: opening a group shows its pages, and a page of a closed group opens it", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await shell.groupButton(groups.reports).click();
    await shell.navLink(labels.nav.leadAnalysis).click();

    await expect(page).toHaveURL(/\/reports\/lead-analysis/);
    await expect(shell.groupButton(groups.reports)).toHaveAttribute("aria-expanded", "true");
    await expect(shell.navLink(labels.nav.leadAnalysis)).toHaveAttribute("aria-current", "page");
  });
});

test.describe("the sidebar as a trainer", () => {
  test.use(signedInAs("PT"));

  test("E2E-150: a group the role has nothing in is not there", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await expect(shell.pageHeading(labels.dashboard.title)).toBeVisible();

    await expect(shell.groupButton(groups.people)).toHaveCount(0);
    await expect(shell.groupButton(groups.config)).toHaveCount(0);
    await expect(shell.groupButton(groups.monitoring)).toHaveCount(0);
  });
});

test.describe("the sidebar on a phone", () => {
  test.use({ ...signedInAs("ADMIN"), viewport: { width: 390, height: 844 } });

  test("E2E-150: the groups work in the sidebar sheet", async ({ page, shell }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: labels.common.toggleSidebar }).click();

    await expect(shell.groupButton(groups.leads)).toHaveAttribute("aria-expanded", "true");
    await shell.groupButton(groups.customers).click();
    await expect(shell.navLink(labels.nav.customers)).toBeVisible();
  });
});
