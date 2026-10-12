import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, uniquePhone } from "./support/data";
import { E2E_USERS } from "./support/db";
import { fill, labels } from "./support/labels";

// Who receives leads and how often (D-050; docs/13). Switching the one consultant off changes where every
// new lead goes, so the spec that does it runs after the others (playwright.config.ts "own-branch") and
// puts it back.
const r = labels.leadReceivers;
const consultant = E2E_USERS.CONSULTING.name;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("a manager switches a consultant's receiving off, and the next lead is not dealt to them; on again, it is", async ({
    apiAs,
    leadReceiversPage,
    page,
    shell,
    testTag,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const reception = await apiAs("RECEPTIONIST");
    const restore = async () => {
      const list = (await (await manager.get("/api/v1/lead-receivers")).json()) as {
        items: { id: string; name: string }[];
      };
      const id = list.items.find((item) => item.name === consultant)!.id;
      await manager.put(`/api/v1/lead-receivers/${id}`, { data: { receivesLeads: true, leadWeight: 1 } });
    };
    try {
      await leadReceiversPage.goto();
      await expect(shell.navLink(labels.nav.leadReceivers)).toBeVisible();
      await expect(leadReceiversPage.row(consultant)).toContainText(r.onDutyYes);
      await expect(leadReceiversPage.receivingSwitch(consultant)).toBeChecked();

      await leadReceiversPage.receivingSwitch(consultant).click();
      await leadReceiversPage.saveButton(consultant).click();
      await expect(toasts(page).getByText(fill(r.saved, { name: consultant }))).toBeVisible();
      await page.reload();
      await expect(leadReceiversPage.receivingSwitch(consultant)).not.toBeChecked();

      const waiting = await createLeadViaApi(reception, { fullName: `Chờ ${testTag}`, phone: uniquePhone() });
      const stays = (await (await manager.get(`/api/v1/leads/${waiting.id}`)).json()) as {
        pic: unknown;
        status: string;
      };
      expect(stays).toMatchObject({ pic: null, status: "NEW" });

      await leadReceiversPage.receivingSwitch(consultant).click();
      await leadReceiversPage.saveButton(consultant).click();
      await expect(
        toasts(page)
          .getByText(fill(r.saved, { name: consultant }))
          .last(),
      ).toBeVisible();
      const dealt = await createLeadViaApi(reception, { fullName: `Nhận ${testTag}`, phone: uniquePhone() });
      const got = (await (await manager.get(`/api/v1/leads/${dealt.id}`)).json()) as { pic: { name: string } | null };
      expect(got.pic?.name).toBe(consultant);
    } finally {
      await restore();
    }
  });

  test("the weight is a whole number from 1 to 20, and the save waits for a good one", async ({
    leadReceiversPage,
  }) => {
    await leadReceiversPage.goto();

    await leadReceiversPage.weightInput(consultant).fill("0");
    await expect(leadReceiversPage.saveButton(consultant)).toBeDisabled();
    await expect(leadReceiversPage.row(consultant).getByRole("alert")).toContainText(labels.validation.outOfRange);
    await leadReceiversPage.weightInput(consultant).fill("21");
    await expect(leadReceiversPage.saveButton(consultant)).toBeDisabled();
    await leadReceiversPage.weightInput(consultant).fill("1");
    // Back to what the server holds: nothing to save.
    await expect(leadReceiversPage.saveButton(consultant)).toBeDisabled();
    await expect(leadReceiversPage.row(consultant).getByRole("alert")).toHaveCount(0);
  });
});

test.describe("as a consultant", () => {
  test.use(signedInAs("CONSULTING"));

  test("the page is not on the menu and is refused by URL", async ({ page, shell }) => {
    await page.goto("/dashboard");
    await expect(shell.navLink(labels.nav.leadReceivers)).toHaveCount(0);

    await page.goto("/leads/receivers");
    await expect(shell.main.getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
  });
});
