import type { APIRequestContext, Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { uniquePhone } from "./support/data";
import { connect } from "./support/db";
import { labels } from "./support/labels";
import { readDownload } from "./support/xlsx";

// The export row limit is a system parameter every export reads, so the spec that lowers it runs
// after the others (playwright.config.ts "own-branch"), where nothing else is exporting
// (A-078; docs/13 E2E-130).
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

async function customerViaApi(api: APIRequestContext, data: Record<string, unknown>) {
  const response = await api.post("/api/v1/customers", { data: { phone: uniquePhone(), ...data } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; fullName: string };
}

test.describe("the export limit", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-130: a list longer than the export limit is refused with a message, and no file", async ({
    page,
    apiAs,
    customersPage,
    testTag,
  }) => {
    const api = await apiAs("RECEPTIONIST");
    await customerViaApi(api, { fullName: `Dài một ${testTag}` });
    await customerViaApi(api, { fullName: `Dài hai ${testTag}` });
    const prisma = connect();
    const before = await prisma.systemParameter.findUnique({ where: { key: "exportRowLimit" } });
    try {
      await prisma.systemParameter.upsert({
        where: { key: "exportRowLimit" },
        create: { key: "exportRowLimit", value: "1" },
        update: { value: "1" },
      });
      await customersPage.goto();
      await customersPage.search(testTag);
      await expect(page).toHaveURL(new RegExp(`q=${testTag}`));
      let downloaded = false;
      page.on("download", () => (downloaded = true));

      await customersPage.exportButton.click();

      const message = labels.common.exportTooLarge.replace("{total}", "2").replace("{limit}", "1");
      await expect(toasts(page).getByText(message)).toBeVisible();
      expect(downloaded).toBe(false);
      // Close the message (it covers the top-right of the page), then narrow the search.
      await toasts(page).getByRole("button", { name: labels.common.close }).click();
      await customersPage.search(`Dài một ${testTag}`);
      await expect(page).toHaveURL(/q=D/);
      await expect(customersPage.table.getByRole("row")).toHaveCount(2);
      const downloading = page.waitForEvent("download");
      await customersPage.exportButton.click();
      expect((await readDownload(await downloading)).rows).toHaveLength(1);
    } finally {
      if (before)
        await prisma.systemParameter.update({
          where: { key: "exportRowLimit" },
          data: { value: before.value as string },
        });
      else await prisma.systemParameter.deleteMany({ where: { key: "exportRowLimit" } });
      await prisma.$disconnect();
    }
  });
});
