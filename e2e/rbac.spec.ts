import { expect, signedInAs, test } from "./fixtures";
import { E2E_USERS } from "./support/db";
import { labels } from "./support/labels";

// E2E-009 (part 1): roles are enforced on the server, not only hidden in the UI.
test.describe("as a trainer", () => {
  test.use(signedInAs("TRAINER"));

  test("there is no administration menu and user management is refused", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await expect(shell.pageHeading(labels.dashboard.title)).toBeVisible();
    await expect(shell.navLink(labels.nav.users)).toHaveCount(0);

    await page.goto("/admin/users");

    await expect(shell.main.getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
    await expect(shell.main.getByRole("table")).toHaveCount(0);
  });

  test("customers cannot be added", async ({ customersPage }) => {
    await customersPage.goto();

    await expect(customersPage.addButton).toHaveCount(0);
  });
});

test.describe("as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("user management lists every account", async ({ page, shell }) => {
    await page.goto("/admin/users");

    const table = shell.main.getByRole("table", { name: labels.users.title });
    for (const user of Object.values(E2E_USERS)) {
      await expect(table.getByRole("row").filter({ hasText: user.email })).toHaveCount(1);
    }
  });
});
