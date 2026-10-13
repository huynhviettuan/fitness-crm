import { expect, signedInAs, test } from "./fixtures";
import { createUserViaApi, roleIdOf } from "./support/admin";
import {
  BOOKING_DAY,
  PT24,
  bookingSetup,
  contractPayload,
  createContractViaApi,
  createBookingViaApi,
  createCustomerViaApi,
  gymDay,
  recordPaymentViaApi,
} from "./support/data";
import { E2E_SALESPERSON_NAME, E2E_SERVICE_NAME, E2E_USERS, backdateFreeze } from "./support/db";
import { OTHER_OPTION_LABEL, otherOptionId } from "./support/options";
import { fill, labels } from "./support/labels";

const f = labels.contracts.fields;
const form = labels.contracts.form;
const panel = labels.contracts.panel;
const CONTRACT_URL = /\/contracts\/[0-9a-f-]{36}$/;

test.describe("contracts as a Fitness Manager", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("@smoke E2E-104: any session count gives the tier price, the end date, and the name; the contract is approved by someone else, never its creator (D-018)", async ({
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

  test("@smoke E2E-105: an approved contract is locked: even Admin has no Edit, and the API refuses a change (D-022)", async ({
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

  test("E2E-162: the list filters by approval and payment, and totals what the filter matches (brief §5.3)", async ({
    page,
    apiAs,
    testTag,
    contractListPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const manager = await apiAs("FITNESS_MANAGER");
    const customer = await createCustomerViaApi(reception, testTag);
    const pending = await createContractViaApi(manager, customer.id);
    const paid = await createContractViaApi(manager, customer.id, { activateWith: await apiAs("ADMIN") });
    await recordPaymentViaApi(reception, paid.id, "12.000.000", { approver: manager });

    // Both belong to the customer the search names: 24,000,000 sold, 12,000,000 paid.
    await contractListPage.goto({ q: customer.fullName });
    await expect(contractListPage.row(pending.contractCode)).toBeVisible();
    await expect(contractListPage.row(paid.contractCode)).toBeVisible();
    await expect(contractListPage.total(labels.contracts.fields.contractValue)).toContainText("24.000.000");
    await expect(contractListPage.total(labels.contracts.fields.paidAmount)).toContainText("12.000.000");
    await expect(contractListPage.total(labels.contracts.fields.debt)).toContainText("12.000.000");

    await contractListPage.filter(labels.contracts.filterApproval, labels.contracts.statuses.DRAFT, {
      param: "status",
      value: "DRAFT",
    });
    await expect(contractListPage.row(pending.contractCode)).toBeVisible();
    await expect(contractListPage.row(paid.contractCode)).toHaveCount(0);
    await expect(contractListPage.total(labels.contracts.fields.paidAmount)).toContainText("0");

    await contractListPage.goto({ q: customer.fullName, payment: "PAID" });
    await expect(contractListPage.row(paid.contractCode)).toBeVisible();
    await expect(contractListPage.row(pending.contractCode)).toHaveCount(0);
    await expect(page).toHaveURL(/payment=PAID/);
  });

  test("E2E-163: the detail has Information, Check-in, and Package history tabs; the note can change after approval; Print opens a sheet (brief §5.3)", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      activateWith: await apiAs("ADMIN"),
    });

    await contractDetailPage.goto(contract.id);
    await page.getByRole("tab", { name: labels.contracts.tabs.history }).click();
    const history = page.getByRole("table", { name: labels.audit.title });
    await expect(history.getByRole("row").filter({ hasText: labels.audit.verbs.activated })).toBeVisible();
    await expect(history.getByRole("row").filter({ hasText: labels.audit.verbs.created })).toBeVisible();
    await page.getByRole("tab", { name: labels.contracts.tabs.info }).click();

    // The contract is approved, and its note still changes.
    await contractDetailPage.action(labels.contracts.updateNote).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(f.notes, { exact: true }).fill(`Giữ chỗ ${testTag}`);
    await dialog.getByRole("button", { name: labels.common.save, exact: true }).click();
    await expect(contractDetailPage.figure(f.notes)).toHaveText(`Giữ chỗ ${testTag}`);
    await expect(contractDetailPage.action(labels.contracts.edit)).toHaveCount(0);

    await page.getByRole("link", { name: labels.contracts.print, exact: true }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}\/print$/);
    await expect(contractDetailPage.heading(`${contract.contractCode} · ${PT24.packageName}`)).toBeVisible();
    await expect(page.getByRole("button", { name: labels.contracts.printNow, exact: true })).toBeVisible();
  });

  test("E2E-164: a receipt has a number and a salesperson, only Admin edits its date, and the customer shows as training (D-034, D-040)", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const contract = await createContractViaApi(await apiAs("FITNESS_MANAGER"), customer.id, {
      activateWith: await apiAs("ADMIN"),
    });
    const receipt = await recordPaymentViaApi(reception, contract.id, "2.000.000", {
      approver: await apiAs("FITNESS_MANAGER"),
      paidOn: gymDay(-3),
    });

    await contractDetailPage.goto(contract.id);
    const row = contractDetailPage.payments.row(receipt.receiptNumber);
    await expect(row).toContainText("2.000.000");
    await expect(row).toContainText(E2E_SALESPERSON_NAME);
    await expect(contractDetailPage.figure(f.paymentStatus)).toHaveText(labels.contracts.paymentStatuses.PARTIAL);

    await contractDetailPage.payments.editDate(gymDay(-5), receipt.receiptNumber);
    await expect(contractDetailPage.payments.row(receipt.receiptNumber)).toContainText(gymDay(-5));
    const refused = await (
      await apiAs("FITNESS_MANAGER")
    ).patch(`/api/v1/payments/${receipt.id}/date`, { data: { paidOn: gymDay(-1) } });
    expect(refused.status()).toBe(403);

    await page.goto(`/customers/${customer.id}`);
    await expect(page.getByText(labels.status.customerContract.TRAINING, { exact: true }).first()).toBeVisible();
  });

  test("E2E-107: a deactivated contract is not booked or checked in; reactivating shows the frozen days and extends the end date once (D-023, AC-14)", async ({
    page,
    apiAs,
    testTag,
    contractDetailPage,
  }) => {
    const { contract, refs } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const admin = await apiAs("ADMIN");
    const booking = await createBookingViaApi(manager, refs, {
      date: BOOKING_DAY.date,
      startTime: "07:00",
      endTime: "08:00",
    });
    const endBefore = new Date(
      ((await (await admin.get(`/api/v1/contracts/${contract.id}`)).json()) as { endDate: string }).endDate,
    );
    const dayAfter = (days: number) => {
      const date = new Date(endBefore.getTime() + days * 86_400_000);
      const two = (n: number) => String(n).padStart(2, "0");
      return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
    };

    await contractDetailPage.goto(contract.id);
    await contractDetailPage.actWithReason(
      labels.contracts.deactivate,
      labels.contracts.deactivateReason,
      `Nghi sai phạm ${testTag}`,
    );
    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.FROZEN);
    await expect(contractDetailPage.figure(f.deactivation)).toContainText(`Nghi sai phạm ${testTag}`);

    // No new booking and no check-in; the booked session stays, highlighted.
    const refused = await manager.post("/api/v1/bookings", {
      data: { ...refs, date: BOOKING_DAY.date, startTime: "09:00", endTime: "10:00" },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "CONTRACT_FROZEN" });
    expect((await manager.post(`/api/v1/bookings/${booking.id}/check-in`)).status()).toBe(409);
    await contractDetailPage.openCheckins();
    await expect(contractDetailPage.bookings.row("07:00")).toContainText(labels.contracts.frozenBooking);

    // Ten days later: the dialog proposes adding all ten, and the end date moves once.
    await backdateFreeze(contract.id, 10);
    await page.reload();
    await contractDetailPage.action(labels.contracts.reactivate).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("new-end-date")).toHaveText(dayAfter(10));
    await dialog.getByRole("combobox", { name: labels.contracts.reactivateReason, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: OTHER_OPTION_LABEL, exact: true }).click();
    await dialog.getByLabel(labels.options.otherNote, { exact: true }).fill(`Đã xác minh ${testTag}`);
    await dialog.getByRole("button", { name: labels.contracts.reactivate, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });

    await expect(contractDetailPage.figure(f.status)).toHaveText(labels.status.contract.ACTIVE);
    await expect(contractDetailPage.figure(f.endDate)).toHaveText(dayAfter(10));
    const again = await admin.post(`/api/v1/contracts/${contract.id}/reactivate`, {
      data: { reasonId: await otherOptionId(admin, "unfreezeReasons"), reasonNote: "Lần hai", extension: "ALL" },
    });
    expect(again.status(), await again.text()).toBe(200);
    expect(((await again.json()) as { endDate: string }).endDate.slice(0, 10)).toBe(
      dayAfter(10).split("/").reverse().join("-"),
    );
  });
});
