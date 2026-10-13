import { expect, test } from "./fixtures";
import { E2E_PASSWORD, E2E_USERS } from "./support/db";
import { labels } from "./support/labels";

test.describe("signing in", () => {
  test("@smoke an admin signs in with email and password and lands on the dashboard", async ({ loginPage, shell }) => {
    await loginPage.goto();
    await loginPage.signIn(E2E_USERS.ADMIN.email, E2E_PASSWORD);

    await expect(shell.pageHeading(labels.dashboard.title)).toBeVisible();
    await shell.expandNav();
    await expect(shell.navLink(labels.nav.users)).toBeVisible();
  });

  test("a wrong password shows one generic message and stays on the login page", async ({ page, loginPage }) => {
    await loginPage.goto();
    await loginPage.signIn(E2E_USERS.RECEPTIONIST.email, "not-the-password");

    await expect(loginPage.error).toHaveText(labels.auth.invalid);
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a signed-out visitor is sent to the login page", async ({ page }) => {
    await page.goto("/customers");

    await expect(page).toHaveURL(/\/login$/);
  });
});
