import type { APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { expect, signedInAs, test } from "./fixtures";
import { approvePendingViaApi } from "./support/approvals";
import { labels } from "./support/labels";
import { createOptionViaApi } from "./support/options";
import { readDownload } from "./support/xlsx";

// The cash book and the money and contract reports (brief §8.1, §9, FR-CASH-005, AC-19; A-138 to A-141; docs/13
// E2E-165). The reports add up the shared database, so the cash book spec brings its own payment method: the row of
// that method is the only one with these figures.
const book = labels.cashBook;

/** A random day in 2015–2024, so no other spec has cash on it. */
function randomPastDay(): { date: string; year: number } {
  const year = 2015 + Math.floor(Math.random() * 10);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  return { date: `15/${month}/${year}`, year };
}

async function firstBranch(api: APIRequestContext): Promise<{ id: string; name: string }> {
  const { items } = (await (await api.get("/api/v1/branches")).json()) as {
    items: { id: string; name: string; active: boolean }[];
  };
  const branch = items.find((candidate) => candidate.active);
  if (!branch) throw new Error("No active branch");
  return branch;
}

/** Records a cash entry as `recorder` and has `approver` approve it (D-018). */
async function recordCash(
  recorder: APIRequestContext,
  approver: APIRequestContext,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await recorder.post("/api/v1/cash-transactions", {
    headers: { "idempotency-key": randomUUID() },
    data,
  });
  expect([201, 202]).toContain(response.status());
  const created = (await response.json()) as { id: string; approvalStatus: string };
  if (created.approvalStatus === "PENDING") await approvePendingViaApi(approver, created.id);
}

test.describe("as an Admin", () => {
  test.use(signedInAs("ADMIN"));

  test("@smoke E2E-165: the cash book closes at opening + in − out, Admin sets the opening balance, and it exports", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const manager = await apiAs("FITNESS_MANAGER");
    const branch = await firstBranch(admin);
    const { date, year } = randomPastDay();
    const method = `Quỹ ${testTag}`;
    const methodId = await createOptionViaApi(admin, "paymentMethods", method);
    const income = await createOptionViaApi(admin, "incomeCategories", `Thu ${testTag}`);
    const expense = await createOptionViaApi(admin, "expenseTypes", `Chi ${testTag}`);
    await recordCash(admin, manager, {
      type: "INCOME",
      categoryId: income,
      methodId,
      amount: "250.000",
      occurredOn: date,
      branchId: branch.id,
    });
    await recordCash(admin, manager, {
      type: "EXPENSE",
      categoryId: expense,
      methodId,
      payee: "Công ty điện lực",
      amount: "100.000",
      occurredOn: date,
      branchId: branch.id,
    });

    await page.goto(`/reports/cash-book?from=${date}&to=${date}&branch=${branch.id}`);

    await expect(page.getByRole("heading", { level: 1, name: book.title })).toBeVisible();
    const methods = page.getByRole("table", { name: book.byMethod });
    // Without an opening balance the method starts empty: closing = 0 + 250,000 − 100,000.
    await expect(methods.getByRole("row").filter({ hasText: method })).toContainText(/250\.000.*100\.000.*150\.000/);
    await expect(page.getByRole("table", { name: book.byDay }).getByRole("row")).toHaveCount(2);

    // Admin sets the opening balance of the branch and method; the closing moves with it.
    await page.getByRole("button", { name: book.opening.button }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: book.opening.branch, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: branch.name, exact: true }).click();
    await dialog.getByRole("combobox", { name: book.opening.method, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: method, exact: true }).click();
    await dialog.getByLabel(book.opening.effectiveOn, { exact: true }).fill(`01/01/${year}`);
    await dialog.getByLabel(book.opening.amount, { exact: true }).fill("1.000.000");
    await dialog.getByRole("button", { name: labels.common.save, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    await expect(methods.getByRole("row").filter({ hasText: method })).toContainText(
      /1\.000\.000.*250\.000.*100\.000.*1\.150\.000/,
    );

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: labels.common.exportExcel }).click();
    const file = await readDownload(await downloading);
    expect(file.name).toBe(book.title);
    expect(file.header).toEqual([
      book.fields.branch,
      book.fields.method,
      book.fields.opening,
      book.fields.inflow,
      book.fields.outflow,
      book.fields.closing,
    ]);
    expect(file.rows.find((row) => row[1] === method)).toEqual([
      branch.name,
      method,
      1_000_000,
      250_000,
      100_000,
      1_150_000,
    ]);
  });

  const reports = [
    { path: "contracts", title: labels.contractReport.title, header: labels.contractReport.fields.service },
    { path: "exception-prices", title: labels.exceptionPrices.title, header: labels.exceptionPrices.fields.person },
    { path: "income-expense", title: labels.incomeExpense.title, header: labels.incomeExpense.fields.kind },
  ];
  for (const report of reports) {
    test(`the ${report.path} report shows its figures for a period and exports to Excel`, async ({ page }) => {
      await page.goto(`/reports/${report.path}?from=01/01/2026&to=31/12/2026`);

      await expect(page.getByRole("heading", { level: 1, name: report.title })).toBeVisible();
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: labels.common.exportExcel }).click();
      const file = await readDownload(await downloading);
      expect(file.name).toBe(report.title);
      expect(file.header).toContain(report.header);
    });
  }

  test("a period that ends before it starts is refused", async ({ apiAs }) => {
    const response = await (await apiAs("ADMIN")).get("/api/v1/reports/cash-book?from=10/10/2026&to=01/10/2026");
    expect(response.status()).toBe(400);
  });
});

test.describe("as a Receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("the reports are not theirs: a forbidden page and 403 from the API", async ({ page, apiAs }) => {
    for (const path of ["cash-book", "income-expense", "contracts", "exception-prices"]) {
      await page.goto(`/reports/${path}`);
      await expect(page.getByRole("main").getByRole("heading", { name: labels.forbidden.title }), path).toBeVisible();
      expect((await (await apiAs("RECEPTIONIST")).get(`/api/v1/reports/${path}`)).status(), path).toBe(403);
    }
  });
});
