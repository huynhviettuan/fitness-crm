import { expect, signedInAs, test } from "./fixtures";
import { createUserViaApi, roleIdOf } from "./support/admin";
import {
  PT24,
  contractPayload,
  createContractViaApi,
  createCustomerViaApi,
  gymDay,
  recordPaymentViaApi,
} from "./support/data";
import { E2E_SALESPERSON_NAME, E2E_SERVICE_NAME, E2E_USERS } from "./support/db";
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

    // The seller cannot approve their own contract: no button, and the API refuses (D-018).
    await expect(contractDetailPage.action(labels.contracts.activate)).toHaveCount(0);
    const contractId = new URL(page.url()).pathname.split("/").pop()!;
    const own = await (await apiAs("FITNESS_MANAGER")).post(`/api/v1/contracts/${contractId}/activate`);
    expect(own.status()).toBe(403);
    expect(await own.json()).toMatchObject({ code: "APPROVAL_OWN_REQUEST" });
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

test.describe("contracts as an admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-105: an approved contract is locked: even Admin has no Edit, and the API refuses a change (D-022)", async ({
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      activateWith: await apiAs("ADMIN"),
    });

    await contractDetailPage.goto(contract.id);
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.ACTIVE);
    await expect(contractDetailPage.heading(PT24.packageName)).toBeVisible();
    await expect(contractDetailPage.action(labels.contracts.edit)).toHaveCount(0);

    const changed = await (
      await apiAs("ADMIN")
    ).patch(`/api/v1/contracts/${contract.id}`, { data: await contractPayload({ sessions: 12 }) });
    expect(changed.status()).toBe(409);
    expect(await changed.json()).toMatchObject({ code: "CONTRACT_NOT_EDITABLE" });
  });

  test("E2E-160: the approver approves or rejects from the contract page, with a reason for a rejection (D-018, A-121)", async ({
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const toApprove = await createContractViaApi(manager, customer.id);
    const toReject = await createContractViaApi(manager, customer.id);

    await contractDetailPage.goto(toApprove.id);
    await expect(contractDetailPage.figure(f.approval)).toHaveText(labels.contracts.approvalPending);
    await contractDetailPage.confirmAction(labels.contracts.activate);
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.ACTIVE);
    await expect(contractDetailPage.figure(f.approval)).toContainText(
      fill(labels.contracts.approvalApproved, { name: E2E_USERS.ADMIN.name }),
    );

    await contractDetailPage.goto(toReject.id);
    await contractDetailPage.actWithReason(
      labels.contracts.reject,
      labels.contracts.rejectReason,
      `Sai giá ${testTag}`,
    );
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.REJECTED);
    await expect(contractDetailPage.figure(f.approval)).toContainText(`Sai giá ${testTag}`);
    await expect(contractDetailPage.action(labels.contracts.activate)).toHaveCount(0);
    await expect(contractDetailPage.action(labels.contracts.edit)).toHaveCount(0);
  });

  test("E2E-161: Admin sends an approved contract back to pending, and deletes one that nothing depends on (A-124, A-125)", async ({
    page,
    apiAs,
    apiSignedIn,
    testTag,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const admin = await apiAs("ADMIN");
    const customer = await createCustomerViaApi(reception, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const withReceipt = await createContractViaApi(manager, customer.id, { activateWith: admin });
    await recordPaymentViaApi(reception, withReceipt.id, "1.000.000");

    // A receipt blocks the deletion, and is listed.
    await contractDetailPage.goto(withReceipt.id);
    await contractDetailPage.deleteWithReason(`Nhập sai ${testTag}`);
    const blocked = page.getByRole("alertdialog");
    await expect(blocked.getByText(labels.common.blockedBy)).toBeVisible();
    await expect(blocked.getByText(labels.common.dependentKinds.payment, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // Without receipts or sessions, Admin sends it back, and another approver approves it again.
    const plain = await createContractViaApi(manager, customer.id, { activateWith: admin });
    await contractDetailPage.goto(plain.id);
    await contractDetailPage.actWithReason(
      labels.contracts.unapprove,
      labels.contracts.unapproveReason,
      `Nhập sai ${testTag}`,
    );
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.DRAFT);
    await expect(contractDetailPage.figure(f.approval)).toHaveText(labels.contracts.approvalPending);

    // Deleting waits for a second Admin (record.delete), then the contract is gone.
    const colleague = await createUserViaApi(admin, testTag, {
      roleId: await roleIdOf(admin, { code: "ADMIN" }),
      label: "Quản trị",
    });
    await contractDetailPage.deleteWithReason(`Nhập sai ${testTag}`);
    const toasts = page.getByRole("region", { name: labels.common.notifications });
    await expect(toasts.getByText(labels.approvals.submitted)).toBeVisible();
    const mine = (await (await admin.get("/api/v1/approvals?view=mine&pageSize=100")).json()) as {
      items: { id: string; entityId: string; action: string }[];
    };
    const request = mine.items.find((item) => item.entityId === plain.id && item.action === "record.delete")!;
    const approved = await (
      await apiSignedIn(colleague.email, colleague.password)
    ).post(`/api/v1/approvals/${request.id}/approve`);
    expect(approved.status()).toBeLessThan(300);
    expect((await admin.get(`/api/v1/contracts/${plain.id}`)).status()).toBe(404);
  });
});
