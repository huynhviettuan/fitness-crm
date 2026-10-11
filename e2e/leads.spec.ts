import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createCustomerViaApi, uniquePhone } from "./support/data";
import { E2E_USERS } from "./support/db";
import { fill, labels } from "./support/labels";

// Leads (brief §3, §4.1; D-019, D-020; docs/13 E2E-116). The journey across consultants is in
// leads.branch.spec.ts (E2E-117).
const l = labels.leads;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("leads as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-116: a walk-in is added with the quick form, gets an LD code, goes to the consultant, and is listed with its channel", async ({
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

  test("D-019: a phone that is already a customer's is refused, and the form links to that customer", async ({
    page,
    apiAs,
    testTag,
    leadsPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const phone = (
      (await (await (await apiAs("RECEPTIONIST")).get(`/api/v1/customers/${customer.id}`)).json()) as { phone: string }
    ).phone;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: `Trùng ${testTag}`, phone, channel: "Zalo" });
    await form.save();

    await expect(form.duplicate).toContainText(
      fill(labels.people.duplicateCustomer, { code: customer.customerCode, name: customer.fullName }),
    );
    await form.duplicate
      .getByRole("link", { name: fill(labels.people.openExisting, { code: customer.customerCode }) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
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
