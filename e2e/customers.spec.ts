import { expect, signedInAs, test } from "./fixtures";
import { fill, labels } from "./support/labels";

test.use(signedInAs("RECEPTIONIST"));

test.describe("customers", () => {
  test("E2E-001 (part 1): a receptionist adds a customer and finds them again", async ({
    page,
    shell,
    customersPage,
    customerDetailPage,
    testTag,
  }) => {
    const fullName = `Nguyễn Văn ${testTag}`;

    await customersPage.goto();
    const sheet = await customersPage.openCreate();
    await sheet.fill({ fullName, phone: "0909 555 111", dateOfBirth: "15/03/1990" });
    await sheet.save();

    // A toast confirms it, then the new customer's page opens with a generated code (BR-001).
    const toasts = page.getByRole("region", { name: labels.common.notifications });
    await expect(toasts.getByText(new RegExp(fill(labels.customers.created, { code: "KH\\d{6,}" })))).toBeVisible();
    await expect(customerDetailPage.heading(fullName)).toBeVisible();
    const fields = labels.customers.fields;
    await expect(customerDetailPage.detail(fields.customerCode)).toHaveText(/^KH\d{6,}$/);
    await expect(customerDetailPage.detail(fields.phone)).toHaveText("0909555111");
    await expect(customerDetailPage.detail(fields.dateOfBirth)).toHaveText("15/03/1990");
    const code = (await customerDetailPage.detail(fields.customerCode).textContent())!;

    // Found again from the customer list...
    await customersPage.goto();
    await customersPage.search(code);
    await expect(customersPage.table.getByRole("row").filter({ hasText: fullName })).toHaveCount(1);

    // ...and from the global search, typed without Vietnamese accents.
    const search = await shell.openCustomerSearch();
    await search.getByRole("combobox").fill(`nguyen van ${testTag.toLowerCase()}`);
    await search.getByRole("option", { name: new RegExp(fullName) }).click();
    await expect(customerDetailPage.heading(fullName)).toBeVisible();
  });

  test("required fields are checked before anything is saved", async ({ customersPage }) => {
    await customersPage.goto();
    const sheet = await customersPage.openCreate();

    await sheet.save();

    await expect(sheet.fieldErrors).toHaveText([labels.validation.required, labels.validation.required]);
    await expect(sheet.root).toBeVisible();
  });
});
