// M1 slice 4: the trash (D-035) and the action history (T-048).
import { expect, signedInAs, test } from "./fixtures";
import { createContractViaApi, createCustomerViaApi, recordPaymentViaApi } from "./support/data";
import { fill, labels } from "./support/labels";
import { OTHER_OPTION_LABEL } from "./support/options";

const fin = labels.finance;

test.describe("the trash and the action history as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("AC-13: a deleted payment is in the trash with its reason, and in the record's history", async ({
    apiAs,
    testTag,
    contractDetailPage,
    trashPage,
    auditPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, { activate: true });
    const payment = await recordPaymentViaApi(reception, contract.id, "4.000.000");
    const title = `${contract.contractCode} · ${customer.fullName}`;
    const reason = `Ghi nhầm ${testTag}`;

    await contractDetailPage.goto(contract.id);
    await contractDetailPage.payments.delete({ option: OTHER_OPTION_LABEL, note: reason }, "4.000.000");
    await expect(contractDetailPage.payments.row("4.000.000")).toHaveCount(0);

    await trashPage.goto({ type: "payment" });
    const row = trashPage.row(title);
    await expect(row).toContainText(labels.trash.types.payment);
    await expect(row).toContainText("4.000.000");
    await expect(row).toContainText(reason);
    const detail = await trashPage.view(title);
    await expect(detail).toContainText(fill(labels.trash.detailTitle, { type: labels.trash.types.payment }));
    await expect(detail).toContainText(contract.contractCode);
    await expect(detail).toContainText("4.000.000");
    // Read-only: nothing in the trash restores or purges (D-035).
    await expect(detail.getByRole("button", { name: fin.delete })).toHaveCount(0);

    await auditPage.gotoRecord(payment.id);
    const deleted = auditPage.rows().filter({ hasText: labels.audit.verbs.deleted });
    await expect(deleted).toHaveCount(1);
    await expect(deleted).toContainText(labels.audit.entities.payment);
    await expect(deleted).toContainText(reason);
    await expect(auditPage.rows().filter({ hasText: labels.audit.verbs.created })).toHaveCount(1);
  });
});

test.describe("the trash and the action history as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("AC-13: only management sees them; the menu hides them and the URLs refuse (09_RBAC.md)", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await expect(shell.navLink(labels.nav.trash)).toHaveCount(0);
    await expect(shell.navLink(labels.nav.audit)).toHaveCount(0);

    for (const path of ["/admin/trash", "/admin/audit"]) {
      await page.goto(path);
      await expect(shell.main.getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
    }
  });
});
