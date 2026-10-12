import { expect, signedInAs, test } from "./fixtures";
import { auditCard } from "./pages/lead-audit";
import { createLeadViaApi, uniquePhone } from "./support/data";
import { rememberAuditCriteria, setFirstStep } from "./support/db";
import { fill, labels } from "./support/labels";

// The audit criteria are global configuration every score reads, so the spec that changes them
// runs after the others (playwright.config.ts "own-branch") and puts them back (A-083; docs/13 E2E-134).
const c = labels.auditCriteria;
const a = labels.leadAudit;

test.describe("the audit criteria", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-134: admin switches a criterion off and weighs another, and the lead's score changes at once", async ({
    apiAs,
    leadPage,
    page,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), {
      fullName: `Đổi tiêu chí ${testTag}`,
      phone: uniquePhone(),
    });
    await setFirstStep(lead.id, "onTime");
    const restore = await rememberAuditCriteria();
    try {
      await leadPage.goto(lead.id);
      await expect(auditCard(page)).toContainText("67%");

      await page.goto("/admin/audit-criteria");
      await expect(page.getByRole("heading", { level: 1, name: c.title })).toBeVisible();
      await page.getByRole("switch", { name: `${c.active}: ${a.criteria.needGroup}` }).click();
      await page.getByRole("button", { name: labels.common.save }).click();
      await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(c.saved)).toBeVisible();

      // The need group no longer counts: the step and the phone are all that is checked.
      await leadPage.goto(lead.id);
      await expect(auditCard(page)).toContainText("100%");
      await expect(auditCard(page).getByRole("listitem").filter({ hasText: a.criteria.needGroup })).toContainText(
        a.tab.off,
      );

      await page.goto("/admin/audit-criteria");
      await page.getByRole("switch", { name: `${c.active}: ${a.criteria.needGroup}` }).click();
      await page.getByLabel(`${c.weight}: ${a.criteria.needGroup}`).fill("3");
      await page.getByRole("button", { name: labels.common.save }).click();
      await expect(
        page.getByRole("region", { name: labels.common.notifications }).getByText(c.saved).last(),
      ).toBeVisible();
      await leadPage.goto(lead.id);
      // The step and the phone pass (2) of 5 (the need group weighs 3).
      await expect(auditCard(page)).toContainText("40%");
      await expect(
        auditCard(page)
          .getByRole("listitem")
          .filter({ hasText: fill(a.tab.weight, { weight: 3 }) }),
      ).toHaveCount(1);
    } finally {
      await restore();
    }
  });

  test("a weight outside 1 to 10 is refused before anything is saved", async ({ page }) => {
    await page.goto("/admin/audit-criteria");

    await page.getByLabel(`${c.weight}: ${a.criteria.phone}`).fill("11");

    await expect(page.getByRole("alert").filter({ hasText: labels.validation.weightOutOfRange })).toBeVisible();
    await expect(page.getByRole("button", { name: labels.common.save })).toBeDisabled();
  });
});
