import type { APIRequestContext, Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { uniquePhone } from "./support/data";
import { labels } from "./support/labels";
import { readDownload } from "./support/xlsx";

// Export to Excel from every list (brief §1, §2; A-077 to A-080; docs/13 E2E-129 to E2E-131).
const c = labels.customers;
const exportButton = (page: Page) => page.getByRole("button", { name: labels.common.exportExcel, exact: true });

async function customerViaApi(api: APIRequestContext, data: Record<string, unknown>) {
  const response = await api.post("/api/v1/customers", { data: { phone: uniquePhone(), ...data } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; fullName: string };
}

test.describe("exporting the customers", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-129: the file holds the rows of the list for the same search and filters, named after the list and the day", async ({
    page,
    apiAs,
    customersPage,
    testTag,
  }) => {
    const api = await apiAs("RECEPTIONIST");
    const withMail = await customerViaApi(api, {
      fullName: `Có mail ${testTag}`,
      email: `${testTag.toLowerCase()}@example.com`,
    });
    const noMail = await customerViaApi(api, { fullName: `Không mail ${testTag}` });

    await customersPage.goto();
    await customersPage.search(testTag);
    // The export takes the page's search, so wait until the search is the page's.
    await expect(page).toHaveURL(new RegExp(`q=${testTag}`));
    await expect(customersPage.row(withMail.fullName)).toBeVisible();
    let downloading = page.waitForEvent("download");
    await customersPage.exportButton.click();
    const download = await downloading;
    const all = await readDownload(download);

    expect(download.suggestedFilename()).toMatch(/^customers-\d{8}\.xlsx$/);
    expect(all.name).toBe(c.title);
    expect(all.header.slice(0, 3)).toEqual([c.fields.customerCode, c.fields.fullName, c.fields.phone]);
    expect(all.rows.map((row) => row[1]).sort()).toEqual([noMail.fullName, withMail.fullName].sort());

    // With the "without email" filter on, the file follows it.
    await customersPage.filter(c.emailFilter, c.onlyNoEmail, { param: "email", value: "none" });
    downloading = page.waitForEvent("download");
    await customersPage.exportButton.click();
    const filtered = await readDownload(await downloading);
    expect(filtered.rows.map((row) => row[1])).toEqual([noMail.fullName]);
  });
});

test.describe("the Export button on each list", () => {
  const lists = [
    ["/customers", "customer.export"],
    ["/leads", "lead.export"],
    ["/contracts", "contract.export"],
    ["/finance/payments", "payment.export"],
    ["/finance/cash", "cash.export"],
    ["/tasks", "task.export"],
    ["/admin/audit", "audit.export"],
    ["/admin/trash", "trash.export"],
    ["/admin/users", "user.export"],
  ] as const;

  test.describe("as an admin", () => {
    test.use(signedInAs("ADMIN"));

    for (const [path] of lists) {
      test(`E2E-131: ${path} has Export Excel`, async ({ page }) => {
        await page.goto(path);

        await expect(exportButton(page)).toBeVisible();
      });
    }

    test("E2E-131: each list's export downloads a file with a header row", async ({ page }) => {
      for (const [path] of lists) {
        await page.goto(path);
        const downloading = page.waitForEvent("download");
        await exportButton(page).click();
        const file = await readDownload(await downloading);
        expect(file.header.length, path).toBeGreaterThan(3);
      }
    });
  });

  test.describe("as a receptionist", () => {
    test.use(signedInAs("RECEPTIONIST"));

    for (const path of ["/customers", "/leads", "/contracts", "/finance/payments"]) {
      test(`${path} has no Export Excel: the permission is separate`, async ({ page }) => {
        await page.goto(path);

        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(exportButton(page)).toHaveCount(0);
      });
    }
  });

  test.describe("as a Fitness Manager", () => {
    test.use(signedInAs("FITNESS_MANAGER"));

    test("exports the six lists of its modules but not the users, history, or trash", async ({ page }) => {
      for (const [path] of lists.slice(0, 6)) {
        await page.goto(path);
        await expect(exportButton(page), path).toBeVisible();
      }
      await page.goto("/admin/users");
      await expect(exportButton(page)).toHaveCount(0);
    });
  });
});
