import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { branchWithConsultants, createLeadViaApi, uniquePhone } from "./support/data";
import { fill, labels } from "./support/labels";

// The lead journey across a branch's consultants (brief §3, §4.1; D-020; docs/13 E2E-117).
// Each test makes a branch of its own with two consultants, so the round-robin is the
// test's alone; such specs run in the "own-branch" project (playwright.config.ts).
const l = labels.leads;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("the lead journey as an admin (D-020)", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-117: leads go round-robin; a manager reassigns one and records a refusal; the history and the board show both", async ({
    page,
    apiAs,
    testTag,
    leadsPage,
    leadPage,
  }) => {
    const admin = await apiAs("ADMIN");
    const { branchId, consultants } = await branchWithConsultants(admin, testTag);
    const first = await createLeadViaApi(admin, { fullName: `Lead một ${testTag}`, branchId });
    const second = await createLeadViaApi(admin, { fullName: `Lead hai ${testTag}`, branchId });
    // BR-203: one each, in turn.
    expect([first.pic?.id, second.pic?.id].sort()).toEqual(consultants.map((c) => c.id).sort());
    const from = consultants.find((c) => c.id === first.pic?.id)!;
    const to = consultants.find((c) => c.id !== from.id)!;

    await leadPage.goto(first.id);
    await expect(leadPage.detail(l.journey, l.fields.pic)).toHaveText(from.name);
    const assign = await leadPage.openAssign(first.fullName);
    await assign.choose(to.name);
    await assign.save();
    await expect(toasts(page).getByText(l.assigned)).toBeVisible();
    await expect(leadPage.detail(l.journey, l.fields.pic)).toHaveText(to.name);
    await expect(leadPage.history.first()).toContainText(fill(l.timeline.reassigned, { from: from.name, to: to.name }));

    const refuse = await leadPage.openChangeStatus(first.fullName);
    await refuse.status(labels.status.lead.REFUSED);
    await refuse.save();
    await expect(refuse.root.getByText(labels.validation.required)).toBeVisible();
    await refuse.choose(l.fields.refuseReason, labels.options.other);
    await refuse.field(labels.options.otherNote).fill("Đã có PT riêng");
    await refuse.save();
    await expect(toasts(page).getByText(l.statusChanged)).toBeVisible();
    await expect(leadPage.detail(l.journey, l.fields.status)).toContainText(labels.status.lead.REFUSED);
    await expect(leadPage.detail(l.journey, l.fields.refuseReason)).toHaveText(
      `${labels.options.other}: Đã có PT riêng`,
    );
    // BR-204: never closed; due to be contacted again.
    await expect(leadPage.detail(l.journey, l.fields.contactAgainOn)).toHaveText(/^\d{2}\/\d{2}\/\d{4}$/);
    await expect(leadPage.history.first()).toContainText(
      fill(l.timeline.reason, { reason: `${labels.options.other}: Đã có PT riêng` }),
    );

    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await leadsPage.showBoard();
    await expect(leadsPage.column(labels.status.lead.REFUSED)).toContainText(first.fullName);
    await expect(leadsPage.column(labels.status.lead.CONSULTING)).toContainText(second.fullName);
  });
});

test.describe("leads on a phone (AC-23)", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 812 } });

  test("E2E-117: a consultant adds a lead, sees only their own, books an appointment, and finds it on the board", async ({
    apiAs,
    apiSignedIn,
    page,
    testTag,
    shell,
    leadsPage,
    leadPage,
  }) => {
    const admin = await apiAs("ADMIN");
    const { branchId, consultants } = await branchWithConsultants(admin, testTag);
    const leads = [];
    for (const name of ["Một", "Hai"])
      leads.push(await createLeadViaApi(admin, { fullName: `Lead ${name} ${testTag}`, branchId }));
    const mine = leads[0];
    const me = consultants.find((c) => c.id === mine.pic?.id)!;

    // The sign-in screen has its own specs; here the session comes from the API.
    const session = await apiSignedIn(me.email, me.password);
    await page.context().addCookies((await session.storageState()).cookies);
    await leadsPage.goto();
    await expect(leadsPage.addButton).toBeVisible();
    // Nothing on the page is wider than the phone.
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);
    const form = await leadsPage.openAdd();
    await expect(form.root).toHaveJSProperty("offsetWidth", 375);
    await form.fill({ fullName: `Từ điện thoại ${testTag}`, phone: uniquePhone(), channel: "WhatsApp" });
    await form.save();
    await expect(leadPage.heading(`Từ điện thoại ${testTag}`)).toBeVisible();

    // Scope "only mine" (T-061): the lead they added and the one in their charge, not the other consultant's.
    await leadsPage.goto(`?q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.table.getByRole("row").filter({ hasText: testTag })).toHaveCount(2);
    await expect(leadsPage.row(leads[1].fullName)).toHaveCount(0);

    await leadsPage.open(mine.fullName);
    const book = await leadPage.openChangeStatus(mine.fullName);
    await book.status(labels.status.lead.BOOKED);
    await book.field(l.fields.appointmentDate).fill("20/10/2030");
    await book.field(l.fields.appointmentTime).fill("18:30");
    await book.save();
    await expect(leadPage.detail(l.journey, l.fields.appointmentAt)).toHaveText("20/10/2030 18:30");
    await expect(leadPage.history.first()).toContainText(labels.status.lead.BOOKED);

    await leadsPage.goto(`?view=board&q=${encodeURIComponent(testTag)}`);
    await expect(leadsPage.column(labels.status.lead.BOOKED)).toContainText(mine.fullName);
    // The board scrolls sideways inside itself, never the page.
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);
  });
});
