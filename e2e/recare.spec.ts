import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi, gymToday, leadInRecareViaApi } from "./support/data";
import { E2E_USERS, makeStepDueNow, setContactAgainOn } from "./support/db";
import { labels } from "./support/labels";
import { otherOptionId } from "./support/options";

// The re-care list and the re-care step (brief §4.1 step 10; FR-LEAD-007; BR-204; A-062;
// docs/13 E2E-120 to E2E-122). Re-care leads have fixed past days so the order and "overdue"
// do not depend on today's date; the lead each test makes carries its tag.
const l = labels.leads;
const r = labels.recare;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

/** The gym's today plus `days`, as dd/MM/yyyy. */
function inDays(days: number): string {
  const [d, m, y] = gymToday().date.split("/").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + days));
  return [day.getUTCDate(), day.getUTCMonth() + 1, day.getUTCFullYear()]
    .map((part, index) => String(part).padStart(index === 2 ? 4 : 2, "0"))
    .join("/");
}

test.describe("the re-care list on a phone (AC-23)", () => {
  test.use({ ...signedInAs("CONSULTING"), viewport: { width: 375, height: 812 } });

  test("E2E-120: the consultant's leads in No response, Refused, and No show come by contact-again day, with overdue marked; the filters narrow them", async ({
    apiAs,
    testTag,
    shell,
    recarePage,
  }) => {
    const apis = { reception: await apiAs("RECEPTIONIST"), consultant: await apiAs("CONSULTING") };
    const refused = await leadInRecareViaApi(apis, { fullName: `Từ chối ${testTag}`, status: "REFUSED" });
    const silent = await leadInRecareViaApi(apis, { fullName: `Im lặng ${testTag}`, status: "NO_RESPONSE" });
    const missed = await leadInRecareViaApi(apis, { fullName: `Không đến ${testTag}`, status: "NO_SHOW" });
    const later = await leadInRecareViaApi(apis, { fullName: `Chưa đến hạn ${testTag}`, status: "NO_RESPONSE" });
    await createLeadViaApi(apis.reception, { fullName: `Đang tư vấn ${testTag}` });
    await setContactAgainOn(refused.id, "2020-01-02");
    await setContactAgainOn(silent.id, "2020-01-01");
    await setContactAgainOn(missed.id, "2020-01-03");
    // "Chưa đến hạn" keeps the day the system gave it: today plus recareDays (A-062).

    await recarePage.goto();
    await expect(recarePage.heading).toBeVisible();
    await expect(recarePage.row(`Từ chối ${testTag}`)).toBeVisible();
    // Oldest day first; the lead due later comes after the overdue ones.
    expect(await recarePage.namesWith(testTag)).toEqual([
      silent.fullName,
      refused.fullName,
      missed.fullName,
      later.fullName,
    ]);
    // A lead in Consulting is not in the list.
    await expect(recarePage.row(`Đang tư vấn ${testTag}`)).toHaveCount(0);
    await expect(recarePage.row(silent.fullName)).toContainText(r.overdue);
    await expect(recarePage.row(refused.fullName)).toContainText(r.overdue);
    await expect(recarePage.row(later.fullName)).not.toContainText(r.overdue);
    await expect(recarePage.row(later.fullName)).toContainText(inDays(15));
    await expect(recarePage.row(silent.fullName)).toContainText(E2E_USERS.CONSULTING.name);
    await expect(recarePage.row(refused.fullName)).toContainText(`${labels.options.other}: E2E`);
    // The list scrolls inside its frame, never the page.
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);

    await recarePage.filter(r.fields.status, labels.status.lead.REFUSED, { param: "status", value: "REFUSED" });
    await expect(recarePage.row(refused.fullName)).toBeVisible();
    await expect(recarePage.row(testTag)).toHaveCount(1);

    await recarePage.goto();
    await recarePage.filter(r.overdueFilter, r.overdue, { param: "overdue", value: "true" });
    expect(await recarePage.namesWith(testTag)).toEqual([silent.fullName, refused.fullName, missed.fullName]);
    await expect(recarePage.row(later.fullName)).toHaveCount(0);
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);
  });
});

test.describe("the re-care list of a manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-120: a manager is in charge of none under Mine, and sees the team's leads under All", async ({
    apiAs,
    testTag,
    recarePage,
  }) => {
    const apis = { reception: await apiAs("RECEPTIONIST"), consultant: await apiAs("CONSULTING") };
    const lead = await leadInRecareViaApi(apis, { fullName: `Của tư vấn ${testTag}`, status: "NO_RESPONSE" });
    await setContactAgainOn(lead.id, "2020-01-01");

    await recarePage.goto();
    await expect(recarePage.heading).toBeVisible();
    await expect(recarePage.row(testTag)).toHaveCount(0);
    await recarePage.showScope("all");
    await expect(recarePage.row(lead.fullName)).toContainText(E2E_USERS.CONSULTING.name);
    await expect(recarePage.row(lead.fullName)).toContainText(r.overdue);
    await expect(recarePage.summary).toContainText(/\d+ lead, \d+ quá hạn/);
  });
});

test.describe("the re-care step", () => {
  test.use(signedInAs("CONSULTING"));

  test("E2E-121: 'Đặt lịch' asks for the appointment, books the lead again, and the pre-visit steps appear in today's tasks", async ({
    page,
    apiAs,
    testTag,
    leadPage,
    todayPage,
  }) => {
    const lead = await leadInRecareViaApi(
      { reception: await apiAs("RECEPTIONIST"), consultant: await apiAs("CONSULTING") },
      { fullName: `Hẹn lại ${testTag}`, status: "NO_RESPONSE" },
    );

    await leadPage.goto(lead.id);
    await expect(leadPage.detail(l.journey, l.fields.status)).toContainText(labels.status.lead.NO_RESPONSE);
    await expect(leadPage.checklistStep("Tái chăm sóc")).toContainText(labels.status.leadStep.OPEN);
    const step = await leadPage.completeStep("Tái chăm sóc");
    await step.choose("Đặt lịch");
    await step.save();
    // The appointment is asked for, as when booking from the status dialog.
    await expect(step.root.getByText(labels.validation.required).first()).toBeVisible();
    await step.field(l.fields.appointmentDate).fill("20/10/2030");
    await step.field(l.fields.appointmentTime).fill("18:30");
    await step.save();

    await expect(toasts(page).getByText(labels.checklist.completed)).toBeVisible();
    await expect(leadPage.detail(l.journey, l.fields.status)).toContainText(labels.status.lead.BOOKED);
    await expect(leadPage.detail(l.journey, l.fields.appointmentAt)).toHaveText("20/10/2030 18:30");
    await expect(leadPage.checklistStep("Tái chăm sóc")).toContainText(labels.status.leadStep.DONE);
    await expect(leadPage.history.first()).toContainText(labels.status.lead.BOOKED);
    // The pre-visit steps start again, three hours before the new appointment.
    await expect(leadPage.checklistStep("Nhắc trước hẹn lần 1")).toContainText("20/10/2030 15:30");
    await expect(leadPage.checklistStep("Nhắc trước hẹn lần 1")).toContainText(labels.status.leadStep.OPEN);

    await makeStepDueNow(lead.id, "nhac-truoc-hen-1");
    await todayPage.goto();
    await expect(todayPage.item(lead.fullName, "Nhắc trước hẹn lần 1")).toBeVisible();
  });

  test("E2E-122: 'Từ chối' asks for the reason and sets the next contact-again day; a second refusal sets it again", async ({
    page,
    apiAs,
    testTag,
    leadPage,
    recarePage,
  }) => {
    const apis = { reception: await apiAs("RECEPTIONIST"), consultant: await apiAs("CONSULTING") };
    const lead = await leadInRecareViaApi(apis, { fullName: `Từ chối lại ${testTag}`, status: "NO_RESPONSE" });
    await setContactAgainOn(lead.id, "2020-01-01");

    await leadPage.goto(lead.id);
    const step = await leadPage.completeStep("Tái chăm sóc");
    await step.choose("Từ chối");
    await step.save();
    await expect(step.root.getByText(labels.validation.required).first()).toBeVisible();
    await step.pick(l.fields.refuseReason, labels.options.other);
    await step.field(labels.options.otherNote).fill("Đã có PT riêng");
    await step.save();

    await expect(toasts(page).getByText(labels.checklist.completed)).toBeVisible();
    await expect(leadPage.detail(l.journey, l.fields.status)).toContainText(labels.status.lead.REFUSED);
    await expect(leadPage.detail(l.journey, l.fields.refuseReason)).toHaveText(
      `${labels.options.other}: Đã có PT riêng`,
    );
    // A-062: recareDays (15) after today, not after the earlier day.
    await expect(leadPage.detail(l.journey, l.fields.contactAgainOn)).toHaveText(inDays(15));

    // It is on the consultant's list with that day; sending it back to Consulting and refusing again resets it.
    await recarePage.goto();
    await expect(recarePage.row(lead.fullName)).toContainText(inDays(15));
    await setContactAgainOn(lead.id, "2020-01-01");
    await apis.consultant.post(`/api/v1/leads/${lead.id}/status`, { data: { status: "CONSULTING" } });
    await apis.consultant.post(`/api/v1/leads/${lead.id}/status`, {
      data: {
        status: "REFUSED",
        refuseReasonId: await otherOptionId(apis.consultant, "leadRefuseReasons"),
        refuseReasonNote: "Lần hai",
      },
    });
    await recarePage.goto();
    await expect(recarePage.row(lead.fullName)).toContainText(inDays(15));
  });
});
