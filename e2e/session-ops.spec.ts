import { expect, signedInAs, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "./support/data";
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
