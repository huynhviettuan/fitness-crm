import { expect, signedInAs, test } from "./fixtures";
import { createContractViaApi, createCustomerViaApi, recordPaymentViaApi } from "./support/data";
import { OTHER_OPTION_LABEL, createOptionViaApi } from "./support/options";
import { labels } from "./support/labels";

const cf = labels.contracts.fields;
const fin = labels.finance;

/**
 * A random month in 2015–2024 with a day in it, so this test's cash entries are the only
 * ones in that month's totals while other tests run in parallel.
 */
function randomPastMonth(): { month: string; day: string } {
  const year = 2015 + Math.floor(Math.random() * 10);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  return { month: `${year}-${month}`, day: `15/${month}/${year}` };
}

test.describe("finance as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("E2E-008: payments of 5,000,000 and 3,000,000 leave a debt of 4,000,000", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), (await createCustomerViaApi(reception, testTag)).id, { activate: true });
    const toasts = page.getByRole("region", { name: labels.common.notifications });
    // Payment methods are an admin list (D-016); this test brings its own two.
    const admin = await apiAs("ADMIN");
    const cash = `Tiền mặt ${testTag}`;
    const transfer = `Chuyển khoản ${testTag}`;
    for (const label of [cash, transfer]) await createOptionViaApi(admin, "paymentMethods", label);

    await contractDetailPage.goto(contract.id);
    for (const [amount, method] of [
      ["5.000.000", cash],
      ["3.000.000", transfer],
    ]) {
      const dialog = await contractDetailPage.openRecordPayment();
      await dialog.fill({ amount, method });
      await dialog.save();
      await expect(toasts.getByText(fin.paymentRecorded).first()).toBeVisible();
      await expect(contractDetailPage.payments.row(amount)).toContainText(method);
    }

    await expect(contractDetailPage.figure(cf.paidAmount)).toHaveText(/8\.000\.000/);
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/4\.000\.000/);
    // docs/09: a receptionist records payments but cannot delete them.
    await expect(contractDetailPage.payments.deleteButton("5.000.000")).toHaveCount(0);
  });

  test("a payment above what is still owed is refused (OQ-003 interim)", async ({ page, apiAs, testTag, contractDetailPage }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), (await createCustomerViaApi(reception, testTag)).id, { activate: true });
    await recordPaymentViaApi(reception, contract.id, "10.000.000");

    await contractDetailPage.goto(contract.id);
    const dialog = await contractDetailPage.openRecordPayment();
    await expect(dialog.root).toContainText(/2\.000\.000/);
    await dialog.fill({ amount: "3.000.000", method: OTHER_OPTION_LABEL, methodNote: "Ví MoMo" });
    await dialog.save();

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(labels.errors.PAYMENT_EXCEEDS_CONTRACT_VALUE)).toBeVisible();
    await dialog.cancel();
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/2\.000\.000/);
  });

  test("a receptionist has payments and debt but not income and expenses", async ({ page, financePage, shell }) => {
    await financePage.goto("payments");

    await expect(financePage.tabs.getByRole("link", { name: fin.tabs.payments })).toBeVisible();
    await expect(financePage.tabs.getByRole("link", { name: fin.tabs.debt })).toBeVisible();
    await expect(financePage.tabs.getByRole("link", { name: fin.tabs.cash })).toHaveCount(0);

    await page.goto("/finance/cash");
    await expect(shell.main.getByRole("heading", { name: labels.forbidden.title })).toBeVisible();
  });
});

test.describe("finance as an accountant", () => {
  test.use(signedInAs("ACCOUNTANT"));

  test("E2E-103/AC-04: deleting a payment asks for a reason, Khác only with a note, and puts the amount back into the debt (D-035)", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), (await createCustomerViaApi(reception, testTag)).id, { activate: true });
    await recordPaymentViaApi(reception, contract.id, "5.000.000");

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/7\.000\.000/);
    const dialog = await contractDetailPage.payments.openDelete("5.000.000");
    const confirm = dialog.root.getByRole("button", { name: fin.delete, exact: true });
    await confirm.click();
    await expect(dialog.fieldErrors).toHaveText(labels.validation.required);
    await dialog.choose(OTHER_OPTION_LABEL, "");
    await confirm.click();
    await expect(dialog.fieldErrors).toHaveText(labels.validation.otherNeedsNote);
    await dialog.choose(OTHER_OPTION_LABEL, "Ghi nhầm hợp đồng");
    await dialog.confirm();

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(fin.deleted)).toBeVisible();
    // Deleted records leave the list for the trash (D-035).
    await expect(contractDetailPage.payments.row("5.000.000")).toHaveCount(0);
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/12\.000\.000/);
  });

  test("income and expenses are totalled per month, apart from contract payments (FR-CASH-002, OQ-007 interim)", async ({
    apiAs,
    testTag,
    financePage,
  }) => {
    const { month, day } = randomPastMonth();
    // Categories are admin lists per type (D-016, D-034); this test brings its own.
    const admin = await apiAs("ADMIN");
    await createOptionViaApi(admin, "incomeCategories", `Bán nước ${testTag}`);
    await createOptionViaApi(admin, "expenseTypes", `Điện nước ${testTag}`);

    await financePage.goto("cash", month);
    for (const entry of [
      { type: fin.types.INCOME, category: `Bán nước ${testTag}`, amount: "300.000" },
      { type: fin.types.EXPENSE, category: `Điện nước ${testTag}`, amount: "1.500.000" },
    ]) {
      const dialog = await financePage.openRecordCash();
      await dialog.fill(entry);
      await dialog.root.getByLabel(fin.fields.occurredOn, { exact: true }).fill(day);
      await dialog.save();
    }

    await expect(financePage.total(fin.otherIncome)).toContainText("300.000");
    await expect(financePage.total(fin.expense)).toContainText("1.500.000");
    await expect(financePage.total(fin.contractPayments)).toContainText(/^\D*0\D*$/);

    await financePage.table(fin.tabs.cash).delete({ option: OTHER_OPTION_LABEL, note: "Nhập sai số tiền" }, `Điện nước ${testTag}`);
    await expect(financePage.table(fin.tabs.cash).row(`Điện nước ${testTag}`)).toHaveCount(0);
    await expect(financePage.total(fin.expense)).not.toContainText("1.500.000");
  });
});
