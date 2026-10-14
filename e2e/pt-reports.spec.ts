import { expect, signedInAs, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, randomBookingDay } from "./support/data";
import { fill, labels } from "./support/labels";
import { readDownload } from "./support/xlsx";

// The PT revenue allocation, the booking report, and the overview dashboard (brief §6.5, §9; D-032; docs/13 E2E-111).
// The reports add up the shared database, so each test brings its own PT and looks at a day of its own.
const r = labels.ptRevenue;
const br = labels.bookingReport;
const o = labels.overview;

/** A customer, a PT, and one trained session of the PT on a day of its own. */
async function trainedSession(apiAs: Parameters<typeof bookingSetup>[0], tag: string) {
  const setup = await bookingSetup(apiAs, tag);
  const day = randomBookingDay();
  const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), setup.refs, {
    date: day.date,
    startTime: "09:00",
    endTime: "10:00",
  });
  const done = await (await apiAs("ADMIN")).post(`/api/v1/bookings/${booking.id}/complete`);
  expect(done.status()).toBe(200);
  return { day, customer: setup.customer, trainer: setup.trainer, contractCode: setup.contract.contractCode };
}

test.describe("PT reports as admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-111: the PT revenue allocation shows the trained session, the PT's total, and exports in GymMaster's columns", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { day, customer, trainer, contractCode } = await trainedSession(apiAs, testTag);

    await page.goto(`/reports/pt-revenue?from=${day.date}&to=${day.date}&trainer=${trainer.id}`);

    await expect(page.getByRole("heading", { level: 1, name: r.title })).toBeVisible();
    const card = page.getByRole("region", { name: `${trainer.fullName} (${trainer.employeeCode})` });
    await expect(card).toBeVisible();
    const row = card.getByRole("row").filter({ hasText: customer.customerCode });
    await expect(row).toContainText(customer.fullName);
    await expect(row).toContainText(contractCode);
    // PT 24 sessions at 12,000,000: 500,000 a session, one credited, inside the all-day shift.
    await expect(row).toContainText("12.000.000");
    await expect(row).toContainText(fill(r.shiftValue, { inside: 1, outside: 0 }));
    await expect(row).toContainText(fill(r.ratesValue, { commission: 100, timesheet: 100 }));
    await expect(row).toContainText("500.000");
    const totals = card.getByLabel(fill(r.trainerTotals, { name: trainer.fullName }));
    await expect(totals).toContainText(`${r.totalsOf.credited}1`);
    await expect(totals).toContainText(`${r.totalsOf.allocation}500.000`);

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: labels.common.exportExcel }).click();
    const file = await readDownload(await downloading);
    expect(file.name).toBe(r.title);
    // GymMaster's order: the employee, the member, the contract, the allocation, the credited sessions, the PT's pay.
    expect(file.header.slice(0, 4)).toEqual(["Mã nhân viên", "Tên nhân viên", "Mã hội viên", "Tên hội viên"]);
    expect(file.header).toEqual(
      expect.arrayContaining(["Mã hợp đồng", "Giá trị phân bổ", "Show dạy", "Doanh thu PT", "Điều chỉnh"]),
    );
    const detail = file.rows.find((line) => line[2] === customer.customerCode);
    expect(detail?.[0]).toBe(trainer.employeeCode);
    expect(detail).toContain(500_000);
    // The PT's totals row follows their contracts, and a grand total closes the file.
    expect(file.rows.at(-1)?.[1]).toBe("Tổng cộng");
  });

  test("the booking report lists the session with its check-in and check-out, filters by type, and exports", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { day, customer, trainer } = await trainedSession(apiAs, testTag);
    const query = `from=${day.date}&to=${day.date}&trainer=${trainer.id}`;

    await page.goto(`/reports/bookings?${query}`);

    await expect(page.getByRole("heading", { level: 1, name: br.title })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: customer.customerCode });
    await expect(row).toContainText(customer.fullName);
    await expect(row).toContainText("Đã tập");
    await expect(row).toContainText(trainer.fullName);
    await expect(row).not.toContainText("—");

    // Nothing was added by hand.
    await page.goto(`/reports/bookings?${query}&type=BURN_SHOW`);
    await expect(page.getByRole("heading", { name: br.empty })).toBeVisible();

    await page.goto(`/reports/bookings?${query}`);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: labels.common.exportExcel }).click();
    const file = await readDownload(await downloading);
    expect(file.name).toBe(br.title);
    expect(file.header).toEqual(expect.arrayContaining(["Giờ check-in", "Giờ check-out", "Trạng thái", "Nhân viên"]));
    expect(file.rows.find((line) => line.includes(customer.customerCode))).toBeDefined();
  });

  test("the overview shows the figures of the period and the two charts", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: labels.dashboard.title })).toBeVisible();
    const figures = page.getByRole("region", { name: o.figures });
    for (const key of ["newLeads", "conversionRate", "membersTraining", "activePts", "endingSoon"] as const) {
      await expect(figures.getByRole("heading", { name: o.fields[key] })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: o.byHour })).toBeVisible();
    await expect(page.getByRole("region", { name: o.byMonth })).toBeVisible();
  });
});

test.describe("PT reports as reception", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("reception sees the booking report and the overview, but not the PT revenue", async ({ page }) => {
    await page.goto("/reports/bookings");
    await expect(page.getByRole("heading", { level: 1, name: br.title })).toBeVisible();

    await page.goto("/reports/pt-revenue");
    await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("region", { name: o.byHour })).toBeVisible();
    await expect(page.getByRole("region", { name: o.byMonth })).toBeVisible();
  });
});

test.describe("PT reports as a PT", () => {
  test.use(signedInAs("PT"));

  test("a PT has no PT revenue, no booking report, and the welcome page instead of the overview", async ({
    page,
    apiAs,
  }) => {
    for (const path of ["pt-revenue", "bookings"]) {
      await page.goto(`/reports/${path}`);
      await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
      expect((await (await apiAs("PT")).get(`/api/v1/reports/${path}`)).status(), path).toBe(403);
    }
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: labels.dashboard.comingTitle })).toBeVisible();
  });
});
