import { expect, signedInAs, test } from "./fixtures";
import { BOOKING_DAY, bookingSetup, createBookingViaApi, createTrainerViaApi } from "./support/data";
import { fill, labels } from "./support/labels";

// The PT grid and booking rules (M5.2, brief §6.1; docs/13 E2E-168): every cell bookable, phone width, week view,
// the customer filter, and the refusals.
const b = labels.bookings;

test.describe("PT grid on a phone", () => {
  test.use({ ...signedInAs("RECEPTIONIST"), viewport: { width: 375, height: 812 } });

  test("@smoke E2E-168: books from a cell, then a second trainer at the same time is refused for the same customer", async ({
    page,
    apiAs,
    testTag,
    calendarPage,
  }) => {
    const { customer, contract, trainer } = await bookingSetup(apiAs, testTag);
    const other = await createTrainerViaApi(await apiAs("FITNESS_MANAGER"), `${testTag} B`);
    const toasts = page.getByRole("region", { name: labels.common.notifications });

    await calendarPage.goto(BOOKING_DAY.url, trainer.id);
    const form = await calendarPage.clickSlot(trainer.fullName, "18:00");
    await form.pickCustomer(customer.customerCode, customer.customerCode);
    await form.chooseContract(contract.contractCode);
    await form.save();
    await expect(calendarPage.block(trainer.fullName, customer.fullName)).toContainText("18:00–19:00");

    // Another trainer is free at 18:30, but the customer is not (BR-403).
    const second = await calendarPage.openAddBooking();
    await second.pickCustomer(customer.customerCode, customer.customerCode);
    await second.chooseContract(contract.contractCode);
    await second.chooseTrainer(other.fullName);
    await second.fillSlot({ date: BOOKING_DAY.date, startTime: "18:30", endTime: "19:30" });
    await second.save();

    await expect(toasts.getByText(labels.errors.BOOKING_CUSTOMER_OVERLAP)).toBeVisible();
  });
});

test.describe("PT grid views and filters", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("the week view shows one trainer's days with a count each, and the customer filter narrows the grid", async ({
    apiAs,
    testTag,
    calendarPage,
    page,
  }) => {
    const { customer, refs, trainer } = await bookingSetup(apiAs, testTag);
    const neighbour = await bookingSetup(apiAs, `${testTag} N`);
    const manager = await apiAs("FITNESS_MANAGER");
    const slot = (date: string) => ({ date, startTime: "09:00", endTime: "10:00" });
    await createBookingViaApi(manager, refs, slot(BOOKING_DAY.date));
    await createBookingViaApi(
      manager,
      { ...neighbour.refs, trainerId: trainer.id },
      {
        date: BOOKING_DAY.date,
        startTime: "11:00",
        endTime: "12:00",
      },
    );

    await calendarPage.goto(BOOKING_DAY.url, trainer.id);
    await expect(calendarPage.column(trainer.fullName).getByTestId("booking-block")).toHaveCount(2);
    await expect(page.getByText(fill(b.sessionCount, { count: 2 }))).toBeVisible();

    await page.goto(`/calendar?date=${BOOKING_DAY.url}&trainer=${trainer.id}&customer=${customer.id}`);
    await expect(calendarPage.column(trainer.fullName).getByTestId("booking-block")).toHaveCount(1);
    await expect(calendarPage.block(trainer.fullName, customer.fullName)).toBeVisible();

    await page.goto(`/calendar?date=${BOOKING_DAY.url}&view=week&trainer=${trainer.id}`);
    await expect(calendarPage.columns).toHaveCount(7);
    await expect(page.getByTestId("booking-block")).toHaveCount(2);
  });
});
