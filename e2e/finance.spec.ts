import { expect, signedInAs, test } from "./fixtures";
import { createContractViaApi, createCustomerViaApi, recordPaymentViaApi } from "./support/data";
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
    const contract = await createContractViaApi(reception, (await createCustomerViaApi(reception, testTag)).id, { activate: true });
    const toasts = page.getByRole("region", { name: labels.common.notifications });

    await contractDetailPage.goto(contract.id);
    for (const [amount, method] of [
      ["5.000.000", fin.methods.CASH],
      ["3.000.000", fin.methods.BANK_TRANSFER],
    ]) {
      const dialog = await contractDetailPage.openRecordPayment();
      await dialog.fill({ amount, method });
      await dialog.save();
      await expect(toasts.getByText(fin.paymentRecorded).first()).toBeVisible();
      await expect(contractDetailPage.payments.row(amount)).toContainText(labels.status.payment.CONFIRMED);
    }

    await expect(contractDetailPage.figure(cf.paidAmount)).toHaveText(/8\.000\.000/);
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/4\.000\.000/);
    // docs/09: a receptionist records payments but cannot void them.
    await expect(contractDetailPage.payments.voidButton("5.000.000")).toHaveCount(0);
  });

  test("a payment above what is still owed is refused (OQ-003 interim)", async ({ page, apiAs, testTag, contractDetailPage }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(reception, (await createCustomerViaApi(reception, testTag)).id, { activate: true });
    await recordPaymentViaApi(reception, contract.id, "10.000.000");

    await contractDetailPage.goto(contract.id);
    const dialog = await contractDetailPage.openRecordPayment();
    await expect(dialog.root).toContainText(/2\.000\.000/);
    await dialog.fill({ amount: "3.000.000", method: fin.methods.CASH });
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

  test("voiding a payment asks for a reason and puts the amount back into the debt (A-008)", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const contract = await createContractViaApi(reception, (await createCustomerViaApi(reception, testTag)).id, { activate: true });
    await recordPaymentViaApi(reception, contract.id, "5.000.000");

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/7\.000\.000/);
    const dialog = await contractDetailPage.payments.void("", "5.000.000");
    await expect(dialog.locator('[data-slot="field-error"]')).toHaveText(labels.validation.required);
    await dialog.getByLabel(fin.voidReason, { exact: true }).fill("Ghi nhầm hợp đồng");
    await dialog.getByRole("button", { name: fin.void, exact: true }).click();

    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(fin.voided)).toBeVisible();
    await expect(contractDetailPage.payments.row("5.000.000")).toContainText(labels.status.payment.VOIDED);
    await expect(contractDetailPage.payments.row("5.000.000")).toContainText("Ghi nhầm hợp đồng");
    await expect(contractDetailPage.figure(cf.debt)).toHaveText(/12\.000\.000/);
  });

  test("income and expenses are totalled per month, apart from contract payments (FR-CASH-002, OQ-007 interim)", async ({
    testTag,
    financePage,
  }) => {
    const { month, day } = randomPastMonth();

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

    await financePage.table(fin.tabs.cash).void("Nhập sai số tiền", `Điện nước ${testTag}`);
    await expect(financePage.table(fin.tabs.cash).row(`Điện nước ${testTag}`)).toContainText(labels.status.cashTransaction.VOIDED);
    await expect(financePage.total(fin.expense)).not.toContainText("1.500.000");
  });
});
