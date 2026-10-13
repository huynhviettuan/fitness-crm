import { expect, signedInAs, test } from "./fixtures";
import { BOOKING_DAY, bookingSetup, isoWeekdayOf } from "./support/data";
import { E2E_TRAINER_NAME } from "./support/db";
import { fill, labels } from "./support/labels";

// Employees and PT working schedules (brief §8.4, D-030; docs/13 E2E-114).
const s = labels.employees.schedule;
const weekday = isoWeekdayOf(BOOKING_DAY.date);

test.describe("employees as a manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-114: a manager adds a PT, gives them a shift and a day off, and the calendar shades off-duty time but books any time (D-058)", async ({
    page,
    testTag,
    employeesPage,
    employeePage,
    calendarPage,
  }) => {
    const name = `PT ${testTag}`;
    const toasts = page.getByRole("region", { name: labels.common.notifications });
    const slot = (time: string) =>
      calendarPage
        .column(name)
        .getByRole("button", { name: fill(labels.bookings.addAt, { trainer: name, time }), exact: true });

    await employeesPage.goto();
    const form = await employeesPage.openAdd();
    await form.fill({ fullName: name, phone: "0909 555 114", isTrainer: true });
    await form.save();

    // The new employee opens with a generated NV code, and no shifts yet.
    await expect(toasts.getByText(/NV\d{3,}/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(employeePage.day(weekday)).toContainText(s.dayOffWeekly);

    await employeePage.addShift(weekday, "08:00", "12:00");
    await employeePage.saveSchedule();
    await expect(toasts.getByText(s.saved)).toBeVisible();

    await calendarPage.goto(BOOKING_DAY.url);
    await expect(slot("08:00")).toBeVisible();
    await expect(slot("11:30")).toBeVisible();
    // Inside the shift the cells are plain; before and after it they are shaded, and still bookable (D-058).
    await expect(slot("08:00")).toHaveAttribute("data-on-duty", "true");
    await expect(slot("11:30")).toHaveAttribute("data-on-duty", "true");
    await expect(slot("07:30")).toHaveAttribute("data-on-duty", "false");
    await expect(slot("12:00")).toHaveAttribute("data-on-duty", "false");

    await page.goBack();
    await employeePage.addDayOff(BOOKING_DAY.date, "Nghỉ phép");
    await expect(toasts.getByText(fill(s.dayOffAdded, { date: BOOKING_DAY.date }))).toBeVisible();
    await expect(employeePage.daysOff.getByRole("row").filter({ hasText: BOOKING_DAY.date })).toContainText(
      "Nghỉ phép",
    );

    await calendarPage.goto(BOOKING_DAY.url);
    await expect(calendarPage.column(name)).toBeVisible();
    await expect(slot("08:00")).toHaveAttribute("data-on-duty", "false");
  });

  test("the list finds an employee by name without diacritics and filters PTs", async ({
    apiAs,
    testTag,
    employeesPage,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    await manager.post("/api/v1/employees", { data: { fullName: `Lễ tân Hồng ${testTag}` } });
    await manager.post("/api/v1/employees", { data: { fullName: `PT Đức ${testTag}`, isTrainer: true } });

    await employeesPage.goto(`?q=${encodeURIComponent(`le tan hong ${testTag}`)}`);
    await expect(employeesPage.row(testTag)).toHaveCount(1);
    await expect(employeesPage.row(`Lễ tân Hồng ${testTag}`)).toContainText(labels.status.employee.ACTIVE);

    await employeesPage.goto(`?q=${testTag}&kind=trainers`);
    await expect(employeesPage.row(testTag)).toHaveCount(1);
    await expect(employeesPage.row(testTag)).toContainText(`PT Đức ${testTag}`);
  });
});

test.describe("employees as a PT", () => {
  test.use(signedInAs("PT"));

  test("a PT sees only their own profile and working schedule, and cannot change it (09_RBAC.md)", async ({
    employeesPage,
    employeePage,
  }) => {
    await employeesPage.goto();
    await expect(employeesPage.table.getByRole("row")).toHaveCount(2); // the header and their own row
    await expect(employeesPage.addButton).toHaveCount(0);

    await employeesPage.open(E2E_TRAINER_NAME);
    await expect(employeePage.day(1)).toContainText("00:00–24:00");
    await expect(employeePage.saveScheduleButton).toHaveCount(0);
    await expect(employeePage.daysOff).toHaveCount(0);
  });
});

test.describe("bookings and working hours", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("a booking outside the trainer's on-duty shift is accepted, because a shift is not a limit (D-058)", async ({
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const { contract, trainer } = await bookingSetup(apiAs, testTag);
    const shifts = [{ weekday, start: "06:00", end: "10:00" }];
    expect(
      (
        await (await apiAs("FITNESS_MANAGER")).put(`/api/v1/employees/${trainer.id}/shifts`, { data: { shifts } })
      ).status(),
    ).toBe(200);

    await contractDetailPage.goto(contract.id);
    const form = await contractDetailPage.openAddBooking();
    await form.chooseTrainer(trainer.fullName);
    await form.fillSlot({ date: BOOKING_DAY.date, startTime: "18:00", endTime: "19:00" });
    await form.save();

    await expect(contractDetailPage.bookings.row("18:00")).toContainText("Booked");
  });
});
