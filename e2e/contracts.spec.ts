import { expect, signedInAs, test } from "./fixtures";
import { PT24, createContractViaApi, createCustomerViaApi } from "./support/data";
import { fill, labels } from "./support/labels";

const f = labels.contracts.fields;

test.describe("contracts as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-001 (part 2): a Fitness Manager adds a contract for a customer and activates it", async ({
    page,
    apiAs,
    testTag,
    customerContractsTab,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    await customerContractsTab.open(customer.id);
    const sheet = await customerContractsTab.openCreate();
    await sheet.fill(PT24);
    await sheet.save();

    // A draft is created with a generated code, and nothing is consumed or paid yet.
    const toasts = page.getByRole("region", { name: labels.common.notifications });
    await expect(toasts.getByText(new RegExp(fill(labels.contracts.created, { code: "HD\\d{6,}" })))).toBeVisible();
    await expect(contractDetailPage.heading(PT24.packageName)).toBeVisible();
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.DRAFT);
    await expect(contractDetailPage.figure(f.remainingSessions)).toHaveText("24");
    await expect(contractDetailPage.figure(f.debt)).toHaveText(/12\.000\.000/);

    await contractDetailPage.confirmAction(labels.contracts.activate);

    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.ACTIVE);
    await expect(contractDetailPage.action(labels.contracts.edit)).toHaveCount(0);

    await customerContractsTab.open(customer.id);
    await expect(customerContractsTab.table.getByRole("row").filter({ hasText: PT24.packageName })).toContainText(
      labels.status.contract.ACTIVE,
    );
  });

  test("invalid amounts and dates are explained before anything is saved", async ({ apiAs, testTag, customerContractsTab, contractDetailPage }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    await customerContractsTab.open(customer.id);
    const sheet = await customerContractsTab.openCreate();
    await sheet.fill({ ...PT24, contractValue: "12.5" });
    await sheet.save();
    await expect(contractDetailPage.fieldErrors).toHaveText([labels.validation.invalidAmount]);

    // The date order is checked once every field on its own is valid.
    await sheet.fill({ ...PT24, startDate: "01/10/2026", endDate: "30/09/2026" });
    await sheet.save();
    await expect(contractDetailPage.fieldErrors).toHaveText([labels.validation.endBeforeStart]);
    await expect(sheet.root).toBeVisible();
  });
});

test.describe("contracts as a receptionist", () => {
  test.use(signedInAs("RECEPTIONIST"));

  test("a receptionist sees contracts but cannot add, edit, activate, or cancel them (09_RBAC.md)", async ({
    apiAs,
    testTag,
    customerContractsTab,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id);

    await customerContractsTab.open(customer.id);
    await expect(customerContractsTab.table.getByRole("row").filter({ hasText: PT24.packageName })).toBeVisible();
    await expect(customerContractsTab.createButton).toHaveCount(0);

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.heading(PT24.packageName)).toBeVisible();
    for (const action of [labels.contracts.edit, labels.contracts.activate, labels.contracts.cancel]) {
      await expect(contractDetailPage.action(action)).toHaveCount(0);
    }
  });
});

test.describe("contracts as a manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("a manager cancels an active contract after confirming", async ({ apiAs, testTag, contractDetailPage }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, { activate: true });

    await contractDetailPage.goto(contract.id);
    await contractDetailPage.confirmAction(labels.contracts.cancel);

    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.CANCELLED);
    await expect(contractDetailPage.action(labels.contracts.cancel)).toHaveCount(0);
  });
});
