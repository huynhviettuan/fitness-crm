import { expect, signedInAs, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, gymDay, randomBookingDay } from "./support/data";
import { fill, labels } from "./support/labels";

// Session detail, direct "Đã tập", delete, and bulk completion for a day (M5.3, brief §6.2; docs/13 E2E-108).
const b = labels.bookings;

test.describe("session operations as admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-108: a Booked session is completed straight from its dialog, with no check-in, and then stays locked", async ({
    page,
    apiAs,
    testTag,
    calendarPage,
  }) => {
    const { customer, refs, trainer } = await bookingSetup(apiAs, testTag);
    const day = randomBookingDay();
    await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
      date: day.date,
      startTime: "09:00",
      endTime: "10:00",
    });

    await calendarPage.goto(day.url, trainer.id);
    const sheet = await calendarPage.openBlock(trainer.fullName, customer.fullName);
    await sheet.confirm(b.complete);

    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(fill(b.completed, { remaining: 23 })),
    ).toBeVisible();
    await expect(sheet.detail(b.fields.status)).toContainText("Đã tập");
    await expect(sheet.detail(b.fields.confirmation)).toHaveText(b.confirmation.MANUAL);
    // Locked once set (D-026): nothing is left to do with it.
    for (const action of [b.complete, b.cancel, b.noShow, b.delete, b.reschedule]) {
      await expect(sheet.action(action)).toHaveCount(0);
    }
  });

  test("a session booked by mistake is deleted with a reason and leaves the grid", async ({
    page,
    apiAs,
    testTag,
    calendarPage,
  }) => {
    const { customer, refs, trainer } = await bookingSetup(apiAs, testTag);
    const day = randomBookingDay();
    await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
      date: day.date,
      startTime: "09:00",
      endTime: "10:00",
    });

    await calendarPage.goto(day.url, trainer.id);
    const sheet = await calendarPage.openBlock(trainer.fullName, customer.fullName);
    await sheet.deleteWithReason("Đặt nhầm");

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(b.deleted)).toBeVisible();
    await expect(calendarPage.column(trainer.fullName).getByTestId("booking-block")).toHaveCount(0);
  });

  test("bulk Đã tập: the day's Booked sessions are listed, the ticked ones are completed", async ({
    page,
    apiAs,
    testTag,
    sessionsPage,
  }) => {
    const first = await bookingSetup(apiAs, testTag);
    const second = await bookingSetup(apiAs, `${testTag} B`);
    const day = randomBookingDay();
    const reception = await apiAs("RECEPTIONIST");
    await createBookingViaApi(reception, first.refs, { date: day.date, startTime: "09:00", endTime: "10:00" });
    await createBookingViaApi(reception, second.refs, { date: day.date, startTime: "11:00", endTime: "12:00" });

    await sessionsPage.goto();
    const dialog = await sessionsPage.openCompleteDay(day.date);
    await expect(dialog.getByRole("checkbox", { name: new RegExp(`${first.customer.fullName} ·`) })).toBeChecked();
    await dialog.getByRole("checkbox", { name: new RegExp(`${second.customer.fullName} ·`) }).uncheck();
    await dialog.getByRole("button", { name: fill(b.completeDay.submit, { count: 1 }), exact: true }).click();

    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(fill(b.completeDay.done, { count: 1 })),
    ).toBeVisible();
    const manager = await apiAs("FITNESS_MANAGER");
    const statusOf = async (customerId: string) =>
      ((await (await manager.get(`/api/v1/bookings?customerId=${customerId}`)).json()).items[0] as { status: string })
        .status;
    expect(await statusOf(first.customer.id)).toBe("TRAINED");
    expect(await statusOf(second.customer.id)).toBe("BOOKED");
  });
});

// Delete from the check-in history and Burn Show (M5.4, brief §6.3, D-026, D-028; docs/13 E2E-109).
test.describe("the check-in history as admin", () => {
  test.use(signedInAs("ADMIN"));

  /** A session trained yesterday, so it can be deleted from the history. */
  async function trainedYesterday(apiAs: Parameters<typeof bookingSetup>[0], testTag: string) {
    const setup = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const day = gymDay(-1);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), setup.refs, {
      date: day,
      startTime: "09:00",
      endTime: "10:00",
    });
    expect((await admin.post(`/api/v1/bookings/${booking.id}/complete`)).ok()).toBe(true);
    const remaining = async () =>
      ((await (await admin.get(`/api/v1/contracts/${setup.contract.id}`)).json()) as { remainingSessions: number })
        .remainingSessions;
    return { ...setup, admin, day, remaining };
  }

  test("@smoke E2E-109: a trained session is deleted from the history with a refund and one email", async ({
    page,
    apiAs,
    testTag,
    sessionsPage,
  }) => {
    const { customer, trainer, admin, remaining } = await trainedYesterday(apiAs, testTag);
    expect(await remaining()).toBe(23);

    await sessionsPage.goto();
    await sessionsPage.showView(b.views.completed);
    const table = sessionsPage.table(b.views.completed);
    const sheet = await table.open(customer.fullName, trainer.fullName);
    await expect(sheet.action(b.deleteHistory)).toBeVisible();
    await sheet.deleteFromHistory("Ghi nhầm buổi tập");

    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(b.historyDeleted),
    ).toBeVisible();
    await expect(table.row(customer.fullName, trainer.fullName)).toHaveCount(0);
    expect(await remaining()).toBe(24);
    const emails = (await (await admin.get(`/api/v1/customers/${customer.id}/emails`)).json()) as {
      items: { event: string }[];
    };
    expect(emails.items.filter((email) => email.event === "session.refunded")).toHaveLength(1);
  });

  test("@smoke E2E-109: Burn Show adds a trained session by hand, which then shows it was added by hand", async ({
    page,
    apiAs,
    testTag,
    sessionsPage,
  }) => {
    const { customer, contract, refs, trainer } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const day = gymDay(-1);

    await sessionsPage.goto();
    const dialog = await sessionsPage.openBurnShow();
    await dialog.pickCustomer(customer.fullName, customer.customerCode);
    await dialog.chooseContract(contract.contractCode);
    await dialog.chooseTrainer(trainer.fullName);
    await dialog.fillSlot({ date: day, startTime: "09:00", endTime: "10:00" });
    await sessionsPage.chooseBurnReason(dialog, "Buổi tập không có lịch hẹn");
    await dialog.save();

    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(fill(b.burned, { remaining: 23 })),
    ).toBeVisible();
    const row = (await (await admin.get(`/api/v1/bookings?contractId=${refs.contractId}`)).json()) as {
      items: { status: string; addedByHand: boolean }[];
    };
    expect(row.items).toMatchObject([{ status: "TRAINED", addedByHand: true }]);

    await sessionsPage.showView(b.views.completed);
    const sheet = await sessionsPage.table(b.views.completed).open(customer.fullName, trainer.fullName);
    await expect(sheet.detail(b.fields.status)).toContainText(b.addedByHand);
    // Locked once set (D-026): the only correction is the history.
    await expect(sheet.action(b.deleteHistory)).toBeVisible();
    await expect(sheet.action(b.cancel)).toHaveCount(0);
  });
});
