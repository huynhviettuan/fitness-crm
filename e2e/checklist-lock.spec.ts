import type { APIRequestContext, Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi } from "./support/data";
import { setStepDue, type Role } from "./support/db";
import { fill, labels } from "./support/labels";

// The checklist lock (M2.7 step 4; the owner's answers of 12/10/2026; D-054): a tick cannot be taken back
// except by admin with a reason, and a step past its deadline and grace period locks as "Không thực hiện".
const c = labels.checklist;
const FIRST = "Tư vấn sản phẩm phù hợp";
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

/** A lead whose first step the E2E consultant has ticked, by the API. */
async function tickedLead(apiAs: (role: Role) => Promise<APIRequestContext>, testTag: string) {
  const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Tick ${testTag}` });
  const consultant = await apiAs("CONSULTING");
  const checklist = (await (await consultant.get(`/api/v1/leads/${lead.id}/steps`)).json()) as {
    items: { id: string; key: string }[];
  };
  const first = checklist.items.find((item) => item.key === "tu-van")!;
  const done = await consultant.post(`/api/v1/leads/${lead.id}/steps/${first.id}/complete`, {
    data: { resultIndex: 0 },
  });
  expect(done.status()).toBe(200);
  return lead;
}

test.describe("as admin", () => {
  test.use(signedInAs("ADMIN"));

  test("admin removes a tick done by mistake with a reason, and the step is open again", async ({
    apiAs,
    leadPage,
    page,
    testTag,
  }) => {
    const lead = await tickedLead(apiAs, testTag);

    await leadPage.goto(lead.id);
    await expect(leadPage.checklistStep(FIRST)).toContainText(labels.status.leadStep.DONE);
    await leadPage
      .checklistStep(FIRST)
      .getByRole("button", { name: fill(c.reopenFor, { step: FIRST }) })
      .click();
    const dialog = page.getByRole("dialog", { name: fill(c.reopenTitle, { step: FIRST }) });
    await dialog.getByRole("combobox", { name: c.reopenReason, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: labels.options.other, exact: true }).click();
    // "Khác" needs its note (D-016).
    await dialog.getByRole("button", { name: c.reopenConfirm, exact: true }).click();
    await expect(dialog.getByText(labels.validation.otherNeedsNote)).toBeVisible();
    await dialog.getByLabel(labels.options.otherNote, { exact: true }).fill("Tick nhầm khách");
    await dialog.getByRole("button", { name: c.reopenConfirm, exact: true }).click();

    await expect(toasts(page).getByText(fill(c.reopened, { step: FIRST }))).toBeVisible();
    await expect(leadPage.checklistStep(FIRST)).toContainText(labels.status.leadStep.OPEN);
    await expect(
      leadPage.checklistStep(FIRST).getByRole("button", { name: fill(c.reopenFor, { step: FIRST }) }),
    ).toHaveCount(0);
  });
});

test.describe("as a consultant", () => {
  test.use(signedInAs("CONSULTING"));

  test("a ticked step cannot be unticked by the consultant: there is no button", async ({
    apiAs,
    leadPage,
    testTag,
  }) => {
    const lead = await tickedLead(apiAs, testTag);

    await leadPage.goto(lead.id);

    await expect(leadPage.checklistStep(FIRST)).toContainText(labels.status.leadStep.DONE);
    await expect(leadPage.checklistStep(FIRST).getByRole("button")).toHaveCount(0);
  });

  test("a step past its deadline and grace period locks as Không thực hiện and cannot be ticked late", async ({
    apiAs,
    leadPage,
    page,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Quá hạn ${testTag}` });
    // Five hours past the deadline: past the two hours' grace.
    await setStepDue(lead.id, "tu-van", 300);

    await leadPage.goto(lead.id);
    const dialog = await leadPage.completeStep(FIRST);
    await dialog.choose("Done");
    await dialog.save();

    await expect(toasts(page).getByText(labels.errors.STEP_LOCKED)).toBeVisible();
    await page.reload();
    await expect(leadPage.checklistStep(FIRST)).toContainText(labels.status.leadStep.NOT_DONE);
    await expect(leadPage.checklistStep(FIRST).getByRole("button")).toHaveCount(0);
  });

  test("inside the grace period the step can still be ticked, and is marked late", async ({
    apiAs,
    leadPage,
    page,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Trễ ${testTag}` });
    await setStepDue(lead.id, "tu-van", 30);

    await leadPage.goto(lead.id);
    const dialog = await leadPage.completeStep(FIRST);
    await dialog.choose("Done");
    await dialog.save();

    await expect(leadPage.checklistStep(FIRST)).toContainText(labels.status.leadStep.DONE);
    await expect(leadPage.checklistStep(FIRST)).toContainText(labels.status.stepTiming.LATE);
    expect(page.url()).toContain(lead.id);
  });
});
