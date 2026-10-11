import type { APIRequestContext, Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, uniquePhone } from "./support/data";
import { fill, labels } from "./support/labels";

// The visit (brief §3 stage 3, §4.1; D-019, D-042; docs/13 E2E-119): Show converts the lead to a
// customer in the same record; No show sends it to re-care.
const v = labels.visit;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

async function bookedLead(apiAs: (role: "RECEPTIONIST" | "CONSULTING") => Promise<APIRequestContext>, name: string) {
  // In the shared branch the lead goes to the E2E consultant (BR-203).
  const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: name });
  const booked = await (
    await apiAs("CONSULTING")
  ).post(`/api/v1/leads/${lead.id}/status`, {
    data: { status: "BOOKED", appointmentDate: "20/10/2030", appointmentTime: "18:30" },
  });
  expect(booked.status()).toBe(200);
  return lead;
}

test.describe("Show at reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-119: the receptionist records Show; the lead becomes a customer with its ID document, after consent", async ({
    page,
    apiAs,
    testTag,
    leadPage,
    leadsPage,
    customerDetailPage,
  }) => {
    const lead = await bookedLead(apiAs, `Khách ${testTag}`);

    await leadPage.goto(lead.id);
    const dialog = await leadPage.openShow(lead.fullName);
    await dialog.fill({
      idDocumentNumber: "0792 0100 1234",
      birthDate: "15/03/1990",
      nationality: "Việt Nam",
      email: `khach-${testTag.toLowerCase()}@example.com`,
      phone: uniquePhone(),
      healthNote: "Đau gối trái",
    });
    await dialog.convert();
    // D-042: nothing is kept without the customer's consent.
    await expect(dialog.root.getByText(labels.validation.consentRequired)).toBeVisible();
    await dialog.consent();
    await dialog.convert();

    await expect(toasts(page).getByText(fill(v.converted, { name: lead.fullName }))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/customers/${lead.id}$`));
    await expect(customerDetailPage.heading(lead.fullName)).toBeVisible();
    await expect(customerDetailPage.detail(labels.customers.fields.customerCode)).toHaveText(/^KH\d+$/);
    await expect(customerDetailPage.detail(labels.customers.fields.idDocument)).toHaveText("CCCD 079201001234");
    await expect(customerDetailPage.detail(labels.customers.fields.healthNote)).toHaveText("Đau gối trái");
    await expect(customerDetailPage.detail(labels.customers.fields.nationality)).toHaveText("Việt Nam");

    // One person, one record: no longer a lead (D-019).
    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.table.getByRole("row").filter({ hasText: testTag })).toHaveCount(0);
  });
});

test.describe("No show on a phone (AC-23)", () => {
  test.use({ ...signedInAs("CONSULTING"), viewport: { width: 375, height: 812 } });

  test("E2E-119: the consultant records No show on the checklist; the lead goes to re-care", async ({
    page,
    apiAs,
    testTag,
    shell,
    leadPage,
  }) => {
    const lead = await bookedLead(apiAs, `Vắng ${testTag}`);

    await leadPage.goto(lead.id);
    const visit = await leadPage.completeStep("Ghi nhận Show / No show");
    await visit.choose("No show");
    await visit.save();

    await expect(toasts(page).getByText(labels.checklist.completed)).toBeVisible();
    await expect(leadPage.detail(labels.leads.journey, labels.leads.fields.status)).toContainText(
      labels.status.lead.NO_SHOW,
    );
    await expect(leadPage.detail(labels.leads.journey, labels.leads.fields.contactAgainOn)).toHaveText(
      /^\d{2}\/\d{2}\/\d{4}$/,
    );
    await expect(leadPage.checklistStep("Tái chăm sóc")).toContainText(labels.status.leadStep.OPEN);
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);
  });
});
