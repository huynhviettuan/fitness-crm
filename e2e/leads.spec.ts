import { expect, signedInAs, test } from "./fixtures";
import { createCustomerViaApi, uniquePhone } from "./support/data";
import { fill, labels } from "./support/labels";

// Leads (brief §3, §4.1; D-019; docs/13 E2E-116).
const l = labels.leads;
const toasts = (page: import("@playwright/test").Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("leads as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-116: a walk-in is added with the quick form, gets an LD code, and is listed as New with its channel", async ({
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
    await expect(leadPage.detail(l.profile, l.fields.status)).toHaveText(labels.status.lead.NEW);
    await expect(leadPage.detail(l.profile, l.fields.phone)).toHaveText(phone);
    await expect(leadPage.detail(l.need, l.fields.needGroup)).toHaveText("2 - Pain Relief & Better Movement");

    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.row(name)).toContainText("Khách tự tìm đến Flow");
    await expect(leadsPage.row(name)).toContainText(labels.status.lead.NEW);
  });

  test("D-019: a phone that is already a customer's is refused, and the form links to that customer", async ({ page, apiAs, testTag, leadsPage }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const phone = ((await (await (await apiAs("RECEPTIONIST")).get(`/api/v1/customers/${customer.id}`)).json()) as { phone: string }).phone;

    await leadsPage.goto();
    const form = await leadsPage.openAdd();
    await form.fill({ fullName: `Trùng ${testTag}`, phone, channel: "Zalo" });
    await form.save();

    await expect(form.duplicate).toContainText(fill(labels.people.duplicateCustomer, { code: customer.customerCode, name: customer.fullName }));
    await form.duplicate.getByRole("link", { name: fill(labels.people.openExisting, { code: customer.customerCode }) }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
  });

  test("Khác needs a note, and an edit keeps the lead's code (D-016)", async ({ page, testTag, leadsPage, leadPage }) => {
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

test.describe("leads on a phone (AC-23)", () => {
  test.use({ ...signedInAs("CONSULTING"), viewport: { width: 375, height: 812 } });

  test("a consultant adds a lead on a phone and sees only their own leads", async ({ apiAs, testTag, shell, leadsPage, leadPage }) => {
    // Another person's lead: hidden from a consultant (scope "only mine").
    await (await apiAs("RECEPTIONIST")).post("/api/v1/leads", {
      data: { fullName: `Của lễ tân ${testTag}`, channelId: await channelId(apiAs, "Zalo") },
    });

    await leadsPage.goto();
    // Nothing on the page is wider than the phone.
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);
    const form = await leadsPage.openAdd();
    await expect(form.root).toHaveJSProperty("offsetWidth", 375);
    await form.fill({ fullName: `Từ điện thoại ${testTag}`, phone: uniquePhone(), channel: "WhatsApp" });
    await form.save();
    await expect(leadPage.heading(`Từ điện thoại ${testTag}`)).toBeVisible();

    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.table.getByRole("row").filter({ hasText: testTag })).toHaveCount(1);
    await expect(leadsPage.row(`Từ điện thoại ${testTag}`)).toBeVisible();
  });
});

async function channelId(apiAs: (role: "RECEPTIONIST") => Promise<import("@playwright/test").APIRequestContext>, label: string): Promise<string> {
  const options = (await (await (await apiAs("RECEPTIONIST")).get("/api/v1/option-lists/leadChannels/options")).json()) as {
    items: { id: string; labelVi: string }[];
  };
  return options.items.find((option) => option.labelVi === label)!.id;
}
