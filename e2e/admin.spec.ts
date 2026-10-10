// M1 slice 2: branches, roles with the permission tree, and per-user access (D-014, D-017).
import { expect, signedInAs, test } from "./fixtures";
import { ADMIN_MADE_PASSWORD, anotherWeekday, createUserViaApi, roleIdOf } from "./support/admin";
import { createCustomerViaApi } from "./support/data";
import { labels } from "./support/labels";

const p = labels.permissions;

test.describe("administration", () => {
  test.use(signedInAs("ADMIN"));

  test("an admin adds a branch, then chooses it when adding a customer (FR-PLT-004, D-014)", async ({
    page,
    testTag,
    branchesPage,
    customersPage,
    shell,
  }) => {
    const branch = `CN ${testTag}`;
    await branchesPage.goto();
    await branchesPage.create(branch, "1 Lê Lợi, Quận 1");
    await expect(branchesPage.table.getByRole("row").filter({ hasText: branch })).toContainText(labels.status.branch.ACTIVE);

    // An admin works in every branch, so a new record asks which one.
    await customersPage.goto();
    const sheet = await customersPage.openCreate();
    await sheet.fill({ fullName: `Khách ${testTag}`, phone: "0909123123", branch });
    await sheet.save();

    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(shell.main.getByText(branch, { exact: true })).toBeVisible();
  });

  test("AC-01: a role with phone numbers hidden never shows them, and its users cannot reach administration by URL", async ({
    page,
    apiAs,
    testTag,
    rolesPage,
    customersPage,
    loginPage,
    shell,
  }) => {
    const roleName = `Xem khách ${testTag}`;
    await rolesPage.gotoNew();
    await rolesPage.fillName(roleName);
    await rolesPage.setPermission(p.labels.customer.view, true);
    await rolesPage.setDataScope(p.resources.customers, p.scopes.ALL);
    await rolesPage.setHidden(p.masks.customer.phone, true);
    await rolesPage.save();
    await expect(rolesPage.heading(roleName)).toBeVisible();

    const admin = await apiAs("ADMIN");
    const user = await createUserViaApi(admin, testTag, { roleId: await roleIdOf(admin, { name: roleName }), label: "Marketing" });
    await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag, "0909777888");

    await page.context().clearCookies();
    await loginPage.goto();
    await loginPage.signIn(user.email, ADMIN_MADE_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);

    await customersPage.goto();
    await customersPage.search(testTag);
    const row = customersPage.table.getByRole("row").filter({ hasText: testTag });
    await expect(row).toContainText(labels.common.hidden);
    await expect(row).not.toContainText("0909777888");
    await expect(customersPage.addButton).toHaveCount(0);
    await expect(shell.navLink(labels.nav.users)).toHaveCount(0);
    await expect(shell.navLink(labels.nav.roles)).toHaveCount(0);

    for (const path of ["/admin/users", "/admin/roles", "/admin/branches", "/contracts"]) {
      await page.goto(path);
      await expect(shell.main.getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
    }
  });

  test("an admin switches one permission on for one user and limits their sign-in hours; refusals are in the history", async ({
    page,
    apiAs,
    apiSignedIn,
    testTag,
    userDetailPage,
  }) => {
    const admin = await apiAs("ADMIN");
    const user = await createUserViaApi(admin, testTag, { roleId: await roleIdOf(admin, { code: "RECEPTIONIST" }), label: "Reception" });
    const toasts = page.getByRole("region", { name: labels.common.notifications });

    await userDetailPage.goto(user.id);
    await userDetailPage.setOverride(p.labels.contract.create, labels.users.overrides.on);
    await expect(toasts.getByText(labels.users.overrides.saved)).toBeVisible();
    const me = await (await (await apiSignedIn(user.email, user.password)).get("/api/v1/me")).json();
    expect(me.permissions).toContain("contract.create");

    const day = labels.users.accessHours.days[String(anotherWeekday()) as keyof typeof labels.users.accessHours.days];
    await userDetailPage.allowOnlyDay(day);
    await expect(toasts.getByText(labels.users.accessHours.saved)).toBeVisible();
    await expect(apiSignedIn(user.email, user.password)).rejects.toThrow();

    // The history is read when the page loads, so reload it to see the refusal.
    await userDetailPage.goto(user.id);
    const history = await userDetailPage.loginHistory();
    await expect(history.getByRole("row").filter({ hasText: labels.users.logins.reasons.OUTSIDE_HOURS })).toHaveCount(1);
    await expect(history.getByRole("row").filter({ hasText: labels.status.login.SUCCESS })).toHaveCount(1);
  });
});
