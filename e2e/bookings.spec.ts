import { expect, signedInAs, test } from "./fixtures";
import {
  BOOKING_DAY,
  bookingSetup,
  createBookingViaApi,
  gymToday,
  randomBookingDay,
} from "./support/data";
import { E2E_TRAINER_NAME } from "./support/db";
import { fill, labels } from "./support/labels";

const cf = labels.contracts.fields;
const b = labels.bookings;
const status = labels.status.booking;

test.describe("bookings as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-002/003: booking and check-in leave the remaining sessions unchanged", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const { contract, trainer } = await bookingSetup(apiAs, testTag);
    const toasts = page.getByRole("region", { name: labels.common.notifications });

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("24");
    const form = await contractDetailPage.openAddBooking();
    await form.chooseTrainer(trainer.fullName);
    await form.fillSlot({ date: BOOKING_DAY.date, startTime: "18:00", endTime: "19:00" });
    await form.save();

    await expect(toasts.getByText(b.created)).toBeVisible();
    await expect(contractDetailPage.bookings.row("18:00")).toContainText(status.BOOKED);
    // E2E-002: booking does not consume.
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("24");

    const sheet = await contractDetailPage.bookings.open("18:00");
    await sheet.action(b.checkIn).click();
    await expect(sheet.detail(b.fields.status)).toHaveText(status.CHECKED_IN);
    // OQ-011: a receptionist cannot complete.
    await expect(sheet.action(b.complete)).toHaveCount(0);
    await sheet.close();

    // E2E-003: check-in does not consume.
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("24");
    await expect(contractDetailPage.figure(cf.completedSessions)).toHaveText("0");
  });

  test("E2E-007: the calendar fills in trainer and time, and refuses an overlapping booking", async ({
    page,
    apiAs,
    testTag,
    calendarPage,
  }) => {
    const { customer, contract, trainer } = await bookingSetup(apiAs, testTag);
    const toasts = page.getByRole("region", { name: labels.common.notifications });

    await calendarPage.goto(BOOKING_DAY.url, trainer.id);
    const form = await calendarPage.clickSlot(trainer.fullName, "18:00");
    await expect(form.field(b.fields.startTime)).toHaveValue("18:00");
    await expect(form.field(b.fields.endTime)).toHaveValue("19:00");
    await form.pickCustomer(customer.customerCode, customer.customerCode);
    await form.chooseContract(contract.contractCode);
    await form.save();
    await expect(calendarPage.block(trainer.fullName, customer.fullName)).toContainText("18:00–19:00");

    // A second booking for the same trainer at 18:30–19:30.
    const overlap = await calendarPage.openAddBooking();
    await overlap.pickCustomer(customer.customerCode, customer.customerCode);
    await overlap.chooseContract(contract.contractCode);
    await overlap.chooseTrainer(trainer.fullName);
    await overlap.fillSlot({ startTime: "18:30", endTime: "19:30" });
    await overlap.save();

    await expect(toasts.getByText(labels.errors.BOOKING_TRAINER_OVERLAP)).toBeVisible();
    // The form stays open with what was typed, so the time can be corrected.
    await expect(overlap.field(b.fields.startTime)).toHaveValue("18:30");
    await overlap.cancel();
    await expect(calendarPage.column(trainer.fullName).getByTestId("booking-block")).toHaveCount(1);
  });

  test("an end time before the start is explained before anything is saved", async ({ apiAs, testTag, customerBookingsTab }) => {
    const { customer, contract, trainer } = await bookingSetup(apiAs, testTag);

    await customerBookingsTab.open(customer.id);
    const form = await customerBookingsTab.openAddBooking();
    await form.chooseContract(contract.contractCode);
    await form.chooseTrainer(trainer.fullName);
    await form.fillSlot({ date: BOOKING_DAY.date, startTime: "19:00", endTime: "18:00" });
    await form.save();

    await expect(form.fieldErrors).toHaveText([labels.validation.endTimeNotAfterStart]);
    await expect(form.root).toBeVisible();
  });
});

test.describe("sessions as a manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-004/005: completing consumes exactly one session, and a retry consumes nothing more", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const { contract, refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const booking = await createBookingViaApi(manager, refs, { date: BOOKING_DAY.date, startTime: "07:00", endTime: "08:00" });
    await manager.post(`/api/v1/bookings/${booking.id}/check-in`);

    await contractDetailPage.goto(contract.id);
    const sheet = await contractDetailPage.bookings.open("07:00");
    const confirmation = await sheet.openConfirmation(b.complete);
    // The effect is stated before confirming (docs/23 §7).
    await expect(confirmation).toContainText("24 → 23");
    await confirmation.getByRole("button", { name: b.complete, exact: true }).click();

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(fill(b.completed, { remaining: 23 }))).toBeVisible();
    await sheet.close();
    // E2E-004
    await expect(contractDetailPage.figure(cf.completedSessions)).toHaveText("1");
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("23");

    // E2E-005: the same completion sent again changes nothing.
    const retry = await manager.post(`/api/v1/bookings/${booking.id}/complete`);
    expect(retry.status()).toBe(200);
    expect((await retry.json()).contract).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    await page.reload();
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("23");
  });

  test("E2E-006: with no sessions left, another session cannot be booked (OQ-008 interim)", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const { contract, trainer, refs } = await bookingSetup(apiAs, testTag, { totalSessions: "1" });
    const manager = await apiAs("FITNESS_MANAGER");
    const booking = await createBookingViaApi(manager, refs, { date: BOOKING_DAY.date, startTime: "07:00", endTime: "08:00" });
    await manager.post(`/api/v1/bookings/${booking.id}/check-in`);
    await manager.post(`/api/v1/bookings/${booking.id}/complete`);

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("0");
    const form = await contractDetailPage.openAddBooking();
    await form.chooseTrainer(trainer.fullName);
    await form.fillSlot({ date: BOOKING_DAY.date, startTime: "09:00", endTime: "10:00" });
    await form.save();

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(labels.errors.CONTRACT_NO_REMAINING_SESSIONS)).toBeVisible();
    await form.cancel();
    await expect(contractDetailPage.figure(cf.remainingSessions)).toHaveText("0");
  });

  test("no-show and cancel consume nothing, and today's sessions are listed (BR-008)", async ({
    apiAs,
    testTag,
    sessionsPage,
  }) => {
    const { customer, refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const today = gymToday();
    await createBookingViaApi(manager, refs, { date: today.date, startTime: "05:00", endTime: "05:30" });
    await createBookingViaApi(manager, refs, { date: today.date, startTime: "05:30", endTime: "06:00" });

    await sessionsPage.goto();
    const table = sessionsPage.table(b.views.today);
    const rows = table.row(customer.fullName);
    await expect(rows).toHaveCount(2);

    let sheet = await table.open(customer.fullName, "05:00–05:30");
    await sheet.confirm(b.noShow);
    await expect(sheet.detail(b.fields.status)).toHaveText(status.NO_SHOW);
    await sheet.close();

    sheet = await table.open(customer.fullName, "05:30–06:00");
    await sheet.confirm(b.cancel);
    await expect(sheet.detail(b.fields.status)).toHaveText(status.CANCELLED);
    await expect(sheet.detail(b.fields.remainingSessions)).toHaveText("24");
    await sheet.close();

    await sessionsPage.showView(b.views.noShow);
    await expect(sessionsPage.table(b.views.noShow).row(customer.fullName)).toHaveCount(1);
  });

  test("D-010: cancelling a contract lists and cancels its booked sessions", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
    customerBookingsTab,
  }) => {
    const { customer, contract, refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    await createBookingViaApi(manager, refs, { date: BOOKING_DAY.date, startTime: "07:00", endTime: "08:00" });
    await createBookingViaApi(manager, refs, { date: BOOKING_DAY.date, startTime: "08:00", endTime: "09:00" });

    await contractDetailPage.goto(contract.id);
    await contractDetailPage.action(labels.contracts.cancel).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation.getByRole("listitem")).toHaveCount(2);
    await confirmation.getByRole("button", { name: labels.contracts.cancel, exact: true }).click();
    await expect(contractDetailPage.figure(cf.status)).toHaveText(labels.status.contract.CANCELLED);

    await customerBookingsTab.open(customer.id);
    for (const time of ["07:00–08:00", "08:00–09:00"]) {
      await expect(customerBookingsTab.table.row(time)).toContainText(status.CANCELLED);
    }
  });
});

test.describe("as a trainer on a phone", () => {
  test.use({ ...signedInAs("PT"), viewport: { width: 375, height: 812 } });

  test("a trainer sees only their own column and completes their own session (A-007, A-012)", async ({
    page,
    apiAs,
    testTag,
    calendarPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const { customer, refs } = await bookingSetup(apiAs, testTag);
    // The PT books as the employee their login belongs to.
    const { employeeId: trainerId } = await (await (await apiAs("PT")).get("/api/v1/me")).json();
    const day = randomBookingDay();
    const booking = await createBookingViaApi(reception, { ...refs, trainerId }, { date: day.date, startTime: "10:00", endTime: "11:00" });
    await reception.post(`/api/v1/bookings/${booking.id}/check-in`);

    await calendarPage.goto(day.url);
    await expect(calendarPage.columns).toHaveCount(1);
    await expect(calendarPage.column(E2E_TRAINER_NAME)).toBeVisible();

    const sheet = await calendarPage.openBlock(E2E_TRAINER_NAME, customer.fullName);
    await sheet.confirm(b.complete);

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(fill(b.completed, { remaining: 23 }))).toBeVisible();
    await expect(sheet.detail(b.fields.status)).toHaveText(status.COMPLETED);
    await sheet.close();
    await expect(calendarPage.block(E2E_TRAINER_NAME, customer.fullName)).toContainText(status.COMPLETED);
  });
});
