import type { Page } from "@playwright/test";
import { expect, signedInAs, test } from "./fixtures";
import { createLeadViaApi } from "./support/data";
import { E2E_USERS } from "./support/db";
import { labels } from "./support/labels";

// The consulting checklist and "Việc hôm nay" (brief §4.1; D-020; FR-LEAD-004/005; docs/13 E2E-118).
const c = labels.checklist;
const toasts = (page: Page) => page.getByRole("region", { name: labels.common.notifications });

test.describe("the consulting checklist on a phone (AC-23)", () => {
  test.use({ ...signedInAs("CONSULTING"), viewport: { width: 375, height: 812 } });

  test("E2E-118: booking does 'Đặt lịch'; a reminder is recorded on time; Báo Studio comes due and is done from today's tasks", async ({
    page,
    apiAs,
    testTag,
    shell,
    leadPage,
    todayPage,
  }) => {
    // In the shared branch the lead goes to the E2E consultant (BR-203).
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
    const booked = await (
      await apiAs("CONSULTING")
    ).post(`/api/v1/leads/${lead.id}/status`, {
      data: { status: "BOOKED", appointmentDate: "20/10/2030", appointmentTime: "18:30" },
    });
    expect(booked.status()).toBe(200);

    await leadPage.goto(lead.id);
    await expect(leadPage.checklistStep("Đặt lịch")).toContainText(labels.status.leadStep.DONE);
    // Three hours before the appointment.
    await expect(leadPage.checklistStep("Nhắc trước hẹn lần 1")).toContainText("20/10/2030 15:30");
    const reminder = await leadPage.completeStep("Nhắc trước hẹn lần 1");
    await reminder.choose("Khách xác nhận");
    await reminder.note("Xác nhận qua Zalo");
    await reminder.save();
    await expect(toasts(page).getByText(c.completed)).toBeVisible();
    await expect(leadPage.checklistStep("Nhắc trước hẹn lần 1")).toContainText(labels.status.stepTiming.ON_TIME);
    await expect(leadPage.checklistStep("Nhắc trước hẹn lần 1")).toContainText("Xác nhận qua Zalo");
    await expect(leadPage.checklistStep("Báo Studio lần 1")).toContainText(labels.status.leadStep.OPEN);

    await todayPage.goto();
    await expect(todayPage.item(lead.fullName, "Báo Studio lần 1")).toBeVisible();
    // Nothing on the page is wider than the phone.
    expect(await shell.scrollWidth()).toBeLessThanOrEqual(375);
    // Its only result is chosen already.
    const studio = await todayPage.complete(lead.fullName, "Báo Studio lần 1");
    await studio.save();
    await expect(toasts(page).getByText(c.completed)).toBeVisible();
    await expect(todayPage.item(lead.fullName, "Báo Studio lần 1")).toHaveCount(0);
  });
});

test.describe("today's tasks of the whole team", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("a manager in charge of no lead sees nothing under Mine and the consultants' steps under All", async ({
    apiAs,
    testTag,
    todayPage,
  }) => {
    const consultant = await apiAs("CONSULTING");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Lead ${testTag}` });
    await consultant.post(`/api/v1/leads/${lead.id}/status`, {
      data: { status: "BOOKED", appointmentDate: "20/10/2030", appointmentTime: "18:30" },
    });
    const { items } = (await (await consultant.get(`/api/v1/leads/${lead.id}/steps`)).json()) as {
      items: { id: string; key: string }[];
    };
    // Done, the reminder opens Báo Studio, due at once.
    const reminder = items.find((item) => item.key === "nhac-truoc-hen-1")!;
    await consultant.post(`/api/v1/leads/${lead.id}/steps/${reminder.id}/complete`, { data: { resultIndex: 0 } });

    await todayPage.goto();
    await expect(todayPage.item(lead.fullName, "Báo Studio lần 1")).toHaveCount(0);
    await todayPage.goto("all");
    await expect(todayPage.item(lead.fullName, "Báo Studio lần 1")).toContainText(E2E_USERS.CONSULTING.name);
  });
});

test.describe("the checklist as configuration (D-020)", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-118: an admin renames a step and saves a new version; new leads get it, earlier leads keep theirs", async ({
    page,
    apiAs,
    testTag,
    restoresChecklist,
    checklistAdminPage,
    leadPage,
  }) => {
    void restoresChecklist;
    const earlier = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Trước ${testTag}` });
    const renamed = `Nhắc lần 1 ${testTag}`;

    await checklistAdminPage.goto();
    // The form opens with the current version's choices.
    await expect(checklistAdminPage.choice(2, labels.checklistAdmin.trigger)).toHaveText(
      labels.checklistAdmin.triggerKinds.STATUS,
    );
    await expect(checklistAdminPage.choice(2, labels.checklistAdmin.triggerStatus)).toHaveText(
      labels.status.lead.NO_RESPONSE,
    );
    await expect(checklistAdminPage.choice(2, labels.checklistAdmin.unit)).toHaveText(
      labels.checklistAdmin.unitNames.HOURS,
    );
    await checklistAdminPage.field(2, labels.checklistAdmin.labelVi).fill(renamed);
    await checklistAdminPage.save();
    await expect(toasts(page).getByText(/^Đã lưu phiên bản \d+$/)).toBeVisible();

    const later = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Sau ${testTag}` });
    await leadPage.goto(later.id);
    await expect(leadPage.checklistStep(renamed)).toBeVisible();
    await leadPage.goto(earlier.id);
    await expect(leadPage.checklistStep("Nhắc lần 1")).toBeVisible();
    await expect(leadPage.checklistStep(renamed)).toHaveCount(0);
  });
});
