import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createCustomerViaApi, createLeadViaApi, uniquePhone } from "./support/data";
import { E2E_USERS } from "./support/db";
import { fill, labels } from "./support/labels";

// Leads (brief §3, §4.1; D-019, D-020; docs/13 E2E-116, E2E-102). The journey across consultants is in
// leads.branch.spec.ts (E2E-117).
const l = labels.leads;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("leads as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("@smoke E2E-116: a walk-in is added with the quick form, gets an LD code, goes to the consultant, and is listed with its channel", async ({
    page,
    testTag,
    leadsPage,
    leadPage,
  }) => {
    const name = `Khách vãng lai ${testTag}`;
    const phone = uniquePhone();

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: name, phone, channel: "Khách tự tìm đến Flow" });
    await form.showMore();
    await form.choose(l.fields.needGroup, "2 - Pain Relief & Better Movement");
    await form.save();

    await expect(toasts(page).getByText(/LD\d{6}/)).toBeVisible();
    await expect(leadPage.heading(name)).toBeVisible();
    // BR-203: the branch's only consultant receives it, so it starts Consulting.
    await expect(leadPage.detail(l.journey, l.fields.status)).toContainText(labels.status.lead.CONSULTING);
    await expect(leadPage.detail(l.journey, l.fields.pic)).toHaveText(E2E_USERS.CONSULTING.name);
    await expect(leadPage.history.last()).toContainText(l.timeline.created);
    await expect(leadPage.detail(l.profile, l.fields.phone)).toHaveText(phone);
    await expect(leadPage.detail(l.need, l.fields.needGroup)).toHaveText("2 - Pain Relief & Better Movement");

    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.row(name)).toContainText("Khách tự tìm đến Flow");
    await expect(leadsPage.row(name)).toContainText(labels.status.lead.CONSULTING);
  });

  test("E2E-102: a phone already in use warns, merges the new contact into the existing lead, and leaves one record", async ({
    page,
    apiAs,
    testTag,
    leadsPage,
    leadPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const phone = uniquePhone();
    const existing = await createLeadViaApi(reception, { fullName: `Khách cũ ${testTag}`, phone });

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: `Khách quay lại ${testTag}`, phone, channel: "Zalo" });
    await form.save();

    // The warning names the existing record; going back keeps what was typed and creates nothing.
    const warning = form.duplicateDialog;
    await expect(warning.root).toContainText(existing.leadCode);
    await expect(warning.root).toContainText(existing.fullName);
    await warning.backToEdit();
    await expect(form.field(l.fields.fullName)).toHaveValue(`Khách quay lại ${testTag}`);
    await form.save();
    await form.duplicateDialog.mergeInto();

    await expect(toasts(page).getByText(fill(labels.people.inquiryAdded, { code: existing.leadCode }))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/leads/${existing.id}$`));
    await expect(leadPage.heading(existing.fullName)).toBeVisible();
    await expect(leadPage.history.first()).toContainText(fill(l.timeline.inquiry, { channel: "Zalo" }));
    // The person is one record: no second lead, and the phone is still the existing one's (D-019).
    const leads = (await (await reception.get(`/api/v1/leads?q=${testTag}`)).json()) as { items: { id: string }[] };
    expect(leads.items.map((lead) => lead.id)).toEqual([existing.id]);
    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.table.getByRole("row").filter({ hasText: testTag })).toHaveCount(1);
  });

  test("E2E-102: a phone that is already a customer's offers the merge too, and the inquiry joins the customer", async ({
    page,
    apiAs,
    testTag,
    leadsPage,
    customerDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const phone = ((await (await reception.get(`/api/v1/customers/${customer.id}`)).json()) as { phone: string }).phone;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: `Trùng ${testTag}`, phone, channel: "Zalo" });
    await form.save();

    const warning = form.duplicateDialog;
    await expect(warning.root).toContainText(customer.customerCode);
    await expect(warning.openExisting(customer.customerCode)).toBeVisible();
    await warning.mergeInto();

    await expect(
      toasts(page).getByText(fill(labels.people.inquiryAdded, { code: customer.customerCode })),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await expect(customerDetailPage.heading(customer.fullName)).toBeVisible();
    // Still one person with that phone, and no lead was made.
    const leads = (await (await reception.get(`/api/v1/leads?q=${testTag}`)).json()) as { total: number };
    expect(leads.total).toBe(0);
  });

  test("Khác needs a note, and an edit keeps the lead's code (D-016)", async ({
    page,
    testTag,
    leadsPage,
    leadPage,
  }) => {
    const name = `Hội chợ ${testTag}`;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: name, channel: labels.options.other });
    await form.save();
    await expect(form.root.getByText(labels.validation.otherNeedsNote)).toBeVisible();
    await form.field(labels.options.otherNote).fill("Hội chợ thể thao");
    await form.save();
    await expect(leadPage.heading(name)).toBeVisible();
    const code = await leadPage.detail(l.profile, l.fields.leadCode).textContent();

    const edit = await leadPage.openEdit();
    await edit.field(l.fields.fullName).fill(`${name} (đã sửa)`);
    await edit.save();
    await expect(toasts(page).getByText(l.updated)).toBeVisible();
    await expect(leadPage.heading(`${name} (đã sửa)`)).toBeVisible();
    await expect(leadPage.detail(l.profile, l.fields.leadCode)).toHaveText(code!);
    await expect(leadPage.detail(l.profile, l.fields.channel)).toHaveText(`${labels.options.other}: Hội chợ thể thao`);
  });
});
