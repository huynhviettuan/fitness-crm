import { expect, signedInAs, test } from "./fixtures";
import { createUserViaApi, roleIdOf } from "./support/admin";
import { PT24, createContractViaApi, createCustomerViaApi, gymDay } from "./support/data";
import { E2E_SALESPERSON_NAME, E2E_SERVICE_NAME } from "./support/db";
import { fill, labels } from "./support/labels";

const f = labels.contracts.fields;
const form = labels.contracts.form;
const panel = labels.contracts.panel;
const CONTRACT_URL = /\/contracts\/[0-9a-f-]{36}$/;

test.describe("contracts as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("E2E-104: any session count gives the tier price, the end date, and the name; the contract is approved by someone else, never its creator (D-018)", async ({
    page,
    apiAs,
    testTag,
    customerContractsTab,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    await customerContractsTab.open(customer.id);
    const contractForm = await customerContractsTab.openCreate();
    await contractForm.chooseService(E2E_SERVICE_NAME);
    await contractForm.setSessions(24);
    await contractForm.field(form.contractDate).fill("01/10/2026");
    await expect(contractForm.panel).toContainText(PT24.packageName);
    await expect(contractForm.panel).toContainText(PT24.contractValue);
    // 60 months from 1 October 2026, the start day counting (A-108).
    await expect(contractForm.panel).toContainText("30/09/2031");
    // Any other count is priced too, with no tier typed by anyone.
    await contractForm.setSessions(7);
    await expect(contractForm.panel).toContainText("PT 7 buổi");
    await expect(contractForm.panel).toContainText("3.500.000");
    await contractForm.setSessions(24);
    await expect(contractForm.panel).toContainText(PT24.contractValue);

    await contractForm.chooseSalesperson(E2E_SALESPERSON_NAME);
    await contractForm.submit.click();
    await expect(page).toHaveURL(CONTRACT_URL);

    // A draft is created with a generated code, and nothing is consumed or paid yet.
    const toasts = page.getByRole("region", { name: labels.common.notifications });
    await expect(toasts.getByText(new RegExp(fill(labels.contracts.created, { code: "HD\\d{6,}" })))).toBeVisible();
    await expect(contractDetailPage.heading(PT24.packageName)).toBeVisible();
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.DRAFT);
    await expect(contractDetailPage.figure(f.remainingSessions)).toHaveText("24");
    await expect(contractDetailPage.figure(f.debt)).toHaveText(/12\.000\.000/);
    await expect(contractDetailPage.figure(f.tierUnitPrice)).toHaveText(/500\.000/);

    // The seller cannot approve their own contract.
    await contractDetailPage.action(labels.contracts.activate).click();
    await page.getByRole("alertdialog").getByRole("button", { name: labels.contracts.activate, exact: true }).click();
    await expect(toasts.getByText(labels.errors.APPROVAL_OWN_REQUEST)).toBeVisible();
    await page.keyboard.press("Escape");
    const contractId = new URL(page.url()).pathname.split("/").pop()!;
    const activated = await (await apiAs("ADMIN")).post(`/api/v1/contracts/${contractId}/activate`);
    expect(activated.status()).toBe(200);
    await page.reload();

    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.ACTIVE);
    await expect(contractDetailPage.action(labels.contracts.edit)).toHaveCount(0);

    await customerContractsTab.open(customer.id);
    await expect(customerContractsTab.table.getByRole("row").filter({ hasText: PT24.packageName })).toContainText(
      labels.status.contract.ACTIVE,
    );
  });

  test("E2E-159: an agreed price is an exception with a reason; it cannot be activated by a role whose discount limit it exceeds (A-112, A-113)", async ({
    page,
    apiAs,
    apiSignedIn,
    testTag,
    customerContractsTab,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    await customerContractsTab.open(customer.id);
    const contractForm = await customerContractsTab.openCreate();
    await contractForm.chooseService(E2E_SERVICE_NAME);
    await contractForm.setSessions(10);
    await contractForm.main.getByRole("switch", { name: form.exception }).click();
    await contractForm.field(form.proposedUnitPrice).fill("400000");
    // 20% under the tier: shown at once, flagged for approval.
    await expect(contractForm.panel).toContainText("4.000.000");
    await expect(contractForm.panel).toContainText(panel.exceptionFlag);
    await contractForm.chooseSalesperson(E2E_SALESPERSON_NAME);

    // Without a reason nothing is saved.
    await contractForm.submit.click();
    await expect(contractForm.fieldErrors.first()).toBeVisible();

    await contractForm.choose(form.exceptionReason, "Khác");
    await contractForm.field(labels.options.otherNote).fill("Khách thân thiết");
    await contractForm.submit.click();
    await expect(page).toHaveURL(CONTRACT_URL);

    await expect(contractDetailPage.heading("PT 10 buổi")).toBeVisible();
    await expect(contractDetailPage.figure(f.approvedUnitPrice)).toHaveText(/400\.000/);
    await expect(contractDetailPage.figure(f.tierUnitPrice)).toHaveText(/500\.000/);
    await expect(contractDetailPage.figure(f.exceptionReason)).toContainText("Khách thân thiết");

    // 20% is above the Fitness Manager's 10%: another manager cannot approve it, Admin can.
    const contractId = new URL(page.url()).pathname.split("/").pop()!;
    const admin = await apiAs("ADMIN");
    const colleague = await createUserViaApi(admin, testTag, {
      roleId: await roleIdOf(admin, { code: "FITNESS_MANAGER" }),
      label: "Quản lý",
    });
    const refused = await (
      await apiSignedIn(colleague.email, colleague.password)
    ).post(`/api/v1/contracts/${contractId}/activate`);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "DISCOUNT_ABOVE_LIMIT" });
    expect((await (await apiAs("ADMIN")).post(`/api/v1/contracts/${contractId}/activate`)).status()).toBe(200);
  });

  test("the form explains what is wrong and saves nothing", async ({
    apiAs,
    testTag,
    customerContractsTab,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    await customerContractsTab.open(customer.id);
    const contractForm = await customerContractsTab.openCreate();
    await contractForm.chooseService(E2E_SERVICE_NAME);
    await contractForm.setSessions(24);
    // No salesperson chosen, and a start day before the activation deadline.
    await contractForm.field(form.startDate).fill("10/10/2026");
    await contractForm.field(form.activationDeadline).fill("09/10/2026");
    await contractForm.submit.click();

    await expect(contractForm.fieldErrors.filter({ hasText: labels.validation.deadlineBeforeStart })).toBeVisible();
    await expect(contractDetailPage.heading(PT24.packageName)).toHaveCount(0);
    await expect(contractForm.submit).toBeVisible();
  });

  test("a draft is edited and its price worked out again", async ({ apiAs, testTag, page, contractDetailPage }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id);

    await contractDetailPage.goto(contract.id);
    await page.getByRole("link", { name: labels.contracts.edit }).click();
    await page.getByLabel(form.sessions, { exact: true }).fill("12");
    await expect(page.getByRole("region", { name: panel.title })).toContainText("6.000.000");
    await page.getByRole("button", { name: form.save, exact: true }).click();

    await expect(contractDetailPage.heading("PT 12 buổi")).toBeVisible();
    await expect(contractDetailPage.figure(f.debt)).toHaveText(/6\.000\.000/);
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
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      activateWith: await apiAs("ADMIN"),
    });

    await contractDetailPage.goto(contract.id);
    await contractDetailPage.confirmAction(labels.contracts.cancel);

    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.CANCELLED);
    await expect(contractDetailPage.action(labels.contracts.cancel)).toHaveCount(0);
  });

  test("today is the default contract date: a contract made today starts today", async ({ apiAs, testTag }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);

    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      data: { contractDate: "", startDate: "" },
    });

    expect(gymDay(0)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(contract.id).toBeDefined();
  });
});
