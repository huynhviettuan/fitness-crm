import type { APIRequestContext } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, gymToday, uniquePhone, showLeadViaApi } from "./support/data";
import { E2E_USERS } from "./support/db";
import { fill, labels } from "./support/labels";

// The customer profile and list filters (brief §4.2; FR-CUS-001, FR-CUS-003, FR-CUS-004,
// FR-CUS-005; A-069 to A-076; docs/13 E2E-126 to E2E-128).
const c = labels.customers;

async function customerViaApi(api: APIRequestContext, data: Record<string, unknown>) {
  const response = await api.post("/api/v1/customers", { data: { phone: uniquePhone(), ...data } });
  if (response.status() !== 201) throw new Error(`Customer setup failed: ${response.status()}`);
  return (await response.json()) as { id: string; fullName: string };
}

test.describe("the customer list filters", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-126: reception filters customers without an email, which are marked, and by birthday month and registration day", async ({
    apiAs,
    customersPage,
    testTag,
  }) => {
    const api = await apiAs("RECEPTIONIST");
    const withMail = await customerViaApi(api, {
      fullName: `Có email ${testTag}`,
      email: `${testTag.toLowerCase()}@example.com`,
      dateOfBirth: "15/03/1990",
    });
    const noMail = await customerViaApi(api, { fullName: `Chưa email ${testTag}`, dateOfBirth: "02/06/1985" });

    await customersPage.goto();
    await customersPage.search(testTag);
    await expect(customersPage.row(withMail.fullName)).toBeVisible();
    await expect(customersPage.row(noMail.fullName)).toBeVisible();
    // Only the one without an email is marked (FR-CUS-005).
    await expect(customersPage.row(noMail.fullName)).toContainText(c.noEmail);
    await expect(customersPage.row(withMail.fullName)).not.toContainText(c.noEmail);

    await customersPage.filter(c.emailFilter, c.onlyNoEmail, { param: "email", value: "none" });
    await expect(customersPage.row(noMail.fullName)).toBeVisible();
    await expect(customersPage.row(withMail.fullName)).toHaveCount(0);

    await customersPage.goto();
    await customersPage.filter(c.birthdayMonth, fill(c.month, { month: 3 }), { param: "birthday", value: "3" });
    await expect(customersPage.row(withMail.fullName)).toBeVisible();
    await expect(customersPage.row(noMail.fullName)).toHaveCount(0);

    // Both registered today; yesterday's range holds neither.
    await customersPage.goto();
    const today = gymToday().date;
    await customersPage.filterDay(c.registeredFrom, today, "from");
    await expect(customersPage.row(withMail.fullName)).toBeVisible();
    await expect(customersPage.row(noMail.fullName)).toBeVisible();
    await customersPage.goto();
    await customersPage.filterDay(c.registeredTo, "01/01/2020", "to");
    await expect(customersPage.row(withMail.fullName)).toHaveCount(0);
  });
});

test.describe("the profile", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-127: reception adds the address, emergency contact, and staff in charge, and the page shows them", async ({
    page,
    apiAs,
    customerDetailPage,
    testTag,
  }) => {
    const customer = await customerViaApi(await apiAs("RECEPTIONIST"), { fullName: `Hồ sơ ${testTag}` });

    await page.goto(`/customers/${customer.id}`);
    await expect(customerDetailPage.heading(customer.fullName)).toBeVisible();
    await page.getByRole("button", { name: c.edit }).click();
    const sheet = page.getByRole("dialog", { name: c.edit });
    await sheet.getByLabel(c.fields.address, { exact: true }).fill("12 Lê Lợi, Quận 1");
    await sheet.getByLabel(c.fields.emergencyContactName, { exact: true }).fill("Nguyễn Thị Hoa");
    await sheet.getByLabel(c.fields.emergencyContactPhone, { exact: true }).fill("0912 345 678");
    await sheet.getByRole("combobox", { name: c.fields.staffInCharge, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: E2E_USERS.CONSULTING.name, exact: true }).click();
    await sheet.getByRole("button", { name: labels.common.save }).click();

    await expect(customerDetailPage.detail(c.fields.address)).toHaveText("12 Lê Lợi, Quận 1");
    await expect(customerDetailPage.detail(c.fields.emergencyContact)).toHaveText("Nguyễn Thị Hoa · 0912345678");
    await expect(customerDetailPage.detail(c.fields.staffInCharge)).toHaveText(E2E_USERS.CONSULTING.name);
  });

  test("E2E-128: a customer who was a lead keeps the consulting history: notes, timeline, and checklist", async ({
    apiAs,
    customerDetailPage,
    page,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const consultant = await apiAs("CONSULTING");
    const phone = uniquePhone();
    const lead = await createLeadViaApi(reception, { fullName: `Từ lead ${testTag}`, phone });
    const note = await consultant.post(`/api/v1/leads/${lead.id}/notes`, {
      data: { body: `Muốn giảm cân ${testTag}` },
    });
    expect(note.status()).toBe(201);
    await showLeadViaApi(reception, lead, phone, `${testTag.toLowerCase()}@example.com`);

    await page.goto(`/customers/${lead.id}`);
    await expect(customerDetailPage.heading(lead.fullName)).toBeVisible();
    await customerDetailPage.openTab(c.tabs.consulting);

    const panel = page.getByRole("tabpanel", { name: c.tabs.consulting });
    await expect(panel.getByRole("region", { name: c.consulting.timeline })).toContainText(`Muốn giảm cân ${testTag}`);
    await expect(
      panel.getByRole("region", { name: c.consulting.checklist }).getByRole("listitem").first(),
    ).toBeVisible();
  });
});
