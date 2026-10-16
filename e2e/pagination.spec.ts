import { expect, signedInAs, test } from "./fixtures";
import { createCustomerViaApi } from "./support/data";
import { labels } from "./support/labels";

// Lists with many pages let you type the page to go to (docs/23 §8). The customers are named with the test's tag, so a
// search for it gives a list of its own.
test.describe("a long list", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("@smoke jumps to a typed page and keeps the search", async ({ page, apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    for (let i = 0; i < 51; i += 1) await createCustomerViaApi(reception, `${testTag} ${i}`);

    await page.goto(`/customers?q=${encodeURIComponent(testTag)}`);
    const jump = page.getByRole("spinbutton", { name: labels.common.pageNumber });
    await expect(jump).toBeVisible();
    await jump.fill("4");
    await page.getByRole("button", { name: labels.common.goToButton, exact: true }).click();
    await expect(page).toHaveURL(/page=4/);
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(testTag)}`));
    await expect(page.getByRole("navigation", { name: /4/ })).toBeVisible();

    // A number past the end goes to the last page; 1 goes back to the first, without a page in the address.
    await jump.fill("99");
    await jump.press("Enter");
    await expect(page).toHaveURL(/page=6/);
    await jump.fill("1");
    await jump.press("Enter");
    await expect(page).not.toHaveURL(/page=/);
  });
});
