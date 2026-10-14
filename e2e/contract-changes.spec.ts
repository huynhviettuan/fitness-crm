import { expect, signedInAs, test } from "./fixtures";
import { approvePendingViaApi } from "./support/approvals";
import { OTHER_OPTION_LABEL, otherOptionId } from "./support/options";
import {
  bookingSetup,
  createBookingViaApi,
  createCustomerViaApi,
  createServiceViaApi,
  recordPaymentViaApi,
} from "./support/data";
import { fill, labels } from "./support/labels";

// Contract change vouchers: renewal and hold (brief §5.6; FR-CHG-001, FR-CHG-002; D-024; docs/13 E2E-174). A voucher waits
// for approval and acts only when approved.
const c = labels.contractChanges;
const historyTab = labels.contracts.tabs.history;

test.describe("a manager raises vouchers", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("@smoke E2E-174: a renewal waits for the admin, then adds the sessions, the end date and what is owed", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);
    const read = async () =>
      (await (await admin.get(`/api/v1/contracts/${contract.id}`)).json()) as {
        totalSessions: number;
        remainingSessions: number;
        contractValue: number;
        debt: number;
        endDate: string;
        voucherSessions: number;
      };
    const before = await read();

    await page.goto(`/contracts/${contract.id}`);
    await page.getByRole("tab", { name: historyTab }).click();
    await expect(page.getByText(c.empty)).toBeVisible();
    await page.getByRole("button", { name: c.renewal, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: fill(c.renewalTitle, { code: contract.contractCode }) });
    // Nothing to add is refused before anything is sent.
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(dialog.getByText(labels.validation.nothingToAdd)).toBeVisible();
    await dialog.getByLabel(c.fields.months, { exact: true }).fill("1");
    await dialog.getByLabel(c.fields.sessions, { exact: true }).fill("12");
    await dialog.getByLabel(c.fields.amount, { exact: true }).fill("3000000");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(notice(c.raisedPending)).toBeVisible();

    // It waits: the contract is as it was, and the table shows the voucher waiting.
    const table = page.getByRole("table", { name: c.title, exact: true });
    await expect(table.getByRole("row").nth(1)).toContainText(labels.status.voucher.PENDING);
    await expect(table.getByRole("row").nth(1)).toContainText(c.kinds.RENEWAL);
    expect(await read()).toMatchObject({ voucherSessions: 0, totalSessions: before.totalSessions });

    // The admin approves it from the inbox's own endpoint; the submitter could not.
    const listed = (await (await admin.get(`/api/v1/contract-changes?contractId=${contract.id}`)).json()) as {
      items: { id: string; voucherNumber: string }[];
    };
    expect(listed.items).toHaveLength(1);
    await approvePendingViaApi(admin, listed.items[0]!.id, "voucher.renewal");
    const after = await read();
    expect(after).toMatchObject({
      voucherSessions: 12,
      totalSessions: before.totalSessions + 12,
      remainingSessions: before.remainingSessions + 12,
      contractValue: before.contractValue + 3_000_000,
      debt: before.debt + 3_000_000,
    });
    expect(new Date(after.endDate).getTime()).toBeGreaterThan(new Date(before.endDate).getTime());

    await page.reload();
    await page.getByRole("tab", { name: historyTab }).click();
    await expect(table.getByRole("row").nth(1)).toContainText(labels.status.voucher.APPROVED);
    await expect(table.getByRole("row").nth(1)).toContainText(listed.items[0]!.voucherNumber);
    await page.getByRole("tab", { name: labels.contracts.tabs.info }).click();
    await expect(page.getByText(labels.contracts.fromVouchers, { exact: true })).toBeVisible();
  });

  test("a hold waits for the admin, then cancels the sessions inside it and refuses new ones", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { contract, refs } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const reception = await apiAs("RECEPTIONIST");
    const inside = await createBookingViaApi(reception, refs, {
      date: "19/06/2031",
      startTime: "10:00",
      endTime: "11:00",
    });
    const notice = (text: string) => page.getByRole("region", { name: labels.common.notifications }).getByText(text);

    await page.goto(`/contracts/${contract.id}`);
    await page.getByRole("tab", { name: historyTab }).click();
    await page.getByRole("button", { name: c.hold, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: fill(c.holdTitle, { code: contract.contractCode }) });
    // An end before the start is refused in the dialog.
    await dialog.getByLabel(c.fields.fromDate, { exact: true }).fill("20/06/2031");
    await dialog.getByLabel(c.fields.toDate, { exact: true }).fill("18/06/2031");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(dialog.getByText(labels.validation.endBeforeStart)).toBeVisible();
    await dialog.getByLabel(c.fields.fromDate, { exact: true }).fill("18/06/2031");
    await dialog.getByLabel(c.fields.toDate, { exact: true }).fill("22/06/2031");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(notice(c.raisedPending)).toBeVisible();
    const table = page.getByRole("table", { name: c.title, exact: true });
    await expect(table.getByRole("row").nth(1)).toContainText(c.kinds.HOLD);
    await expect(table.getByRole("row").nth(1)).toContainText(fill(c.daysCount, { count: 5 }));

    const listed = (await (await admin.get(`/api/v1/contract-changes?contractId=${contract.id}`)).json()) as {
      items: { id: string }[];
    };
    await approvePendingViaApi(admin, listed.items[0]!.id, "voucher.hold");
    // The session booked inside the hold is cancelled, and a new one on a day inside it is refused.
    const booking = (await (await admin.get(`/api/v1/bookings/${inside.id}`)).json()) as { status: string };
    expect(booking.status).toBe("CANCELLED");
    const refused = await reception.post("/api/v1/bookings", {
      data: { ...refs, date: "20/06/2031", startTime: "10:00", endTime: "11:00" },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "CONTRACT_ON_HOLD" });
    // The day after the hold is open again.
    const open = await reception.post("/api/v1/bookings", {
      data: { ...refs, date: "23/06/2031", startTime: "10:00", endTime: "11:00" },
    });
    expect(open.status()).toBe(201);
  });
});

test.describe("a manager exchanges a package", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("an upgrade waits for the admin, then the sessions left become the new package's and the price less the credit is owed", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const service = await createServiceViaApi(admin, `Cao cấp ${testTag}`);
    const read = async () =>
      (await (await admin.get(`/api/v1/contracts/${contract.id}`)).json()) as {
        remainingSessions: number;
        contractValue: number;
      };
    const before = await read();

    await page.goto(`/contracts/${contract.id}`);
    await page.getByRole("tab", { name: historyTab }).click();
    await page.getByRole("button", { name: c.upgrade, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: fill(c.upgradeTitle, { code: contract.contractCode }) });
    // The credit may not pass the price.
    await dialog.getByLabel(c.fields.newSessions, { exact: true }).fill("10");
    await dialog.getByLabel(c.fields.newPrice, { exact: true }).fill("1000000");
    await dialog.getByLabel(c.fields.credit, { exact: true }).fill("2000000");
    await dialog.getByRole("combobox", { name: c.fields.targetService }).click();
    await page.getByRole("option", { name: service.name }).click();
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(dialog.getByText(labels.validation.creditAboveAmount)).toBeVisible();
    await dialog.getByLabel(c.fields.newPrice, { exact: true }).fill("8000000");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(c.raisedPending),
    ).toBeVisible();

    const table = page.getByRole("table", { name: c.title, exact: true });
    await expect(table.getByRole("row").nth(1)).toContainText(c.kinds.UPGRADE);
    await expect(table.getByRole("row").nth(1)).toContainText(service.name);
    expect(await read()).toMatchObject({ remainingSessions: before.remainingSessions });

    const listed = (await (await admin.get(`/api/v1/contract-changes?contractId=${contract.id}`)).json()) as {
      items: { id: string }[];
    };
    await approvePendingViaApi(admin, listed.items[0]!.id, "voucher.upgrade");
    expect(await read()).toMatchObject({
      remainingSessions: 10,
      contractValue: before.contractValue + 6_000_000,
    });
  });
});

test.describe("a manager transfers the sessions left", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("a transfer waits for the admin, then the receiver has a contract of the sessions left and the giver has none", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const receiver = await createCustomerViaApi(await apiAs("RECEPTIONIST"), `${testTag} nhan`);
    await recordPaymentViaApi(await apiAs("FITNESS_MANAGER"), contract.id, "12000000", { approver: admin });
    const read = async (id: string) =>
      (await (await admin.get(`/api/v1/contracts/${id}`)).json()) as {
        remainingSessions: number;
        contractValue: number;
      };

    await page.goto(`/contracts/${contract.id}`);
    await page.getByRole("tab", { name: historyTab }).click();
    await page.getByRole("button", { name: c.transfer, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: fill(c.transferTitle, { code: contract.contractCode }) });
    // Nobody is chosen yet.
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(dialog.getByText(labels.validation.required)).toBeVisible();
    await dialog.getByLabel(c.fields.toCustomer, { exact: true }).fill(receiver.fullName);
    await dialog.getByRole("button", { name: new RegExp(receiver.customerCode) }).click();
    await dialog.getByLabel(c.fields.transferValue, { exact: true }).fill("6000000");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(c.raisedPending),
    ).toBeVisible();

    const table = page.getByRole("table", { name: c.title, exact: true });
    await expect(table.getByRole("row").nth(1)).toContainText(c.kinds.TRANSFER);
    await expect(table.getByRole("row").nth(1)).toContainText(receiver.customerCode);
    expect((await read(contract.id)).remainingSessions).toBe(24);

    const listed = (await (await admin.get(`/api/v1/contract-changes?contractId=${contract.id}`)).json()) as {
      items: { id: string }[];
    };
    await approvePendingViaApi(admin, listed.items[0]!.id, "voucher.transfer");
    expect((await read(contract.id)).remainingSessions).toBe(0);
    const theirs = (await (await admin.get(`/api/v1/contracts?customerId=${receiver.id}`)).json()) as {
      items: { id: string; contractType: string; status: string }[];
    };
    expect(theirs.items).toHaveLength(1);
    expect(theirs.items[0]).toMatchObject({ contractType: "TRANSFER", status: "ACTIVE" });
    expect(await read(theirs.items[0]!.id)).toMatchObject({ remainingSessions: 24, contractValue: 6_000_000 });

    // The history now links to the receiver's contract.
    await page.reload();
    await page.getByRole("tab", { name: historyTab }).click();
    await expect(table.getByRole("link").first()).toBeVisible();
  });
});

test.describe("a manager cancels a contract", () => {
  test.use(signedInAs("FITNESS_MANAGER"));

  test("a cancellation waits for the admin, then ends the contract and records the refund as an expense", async ({
    page,
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const manager = await apiAs("FITNESS_MANAGER");
    await recordPaymentViaApi(manager, contract.id, "12000000", { approver: admin });
    const read = async () =>
      (await (await admin.get(`/api/v1/contracts/${contract.id}`)).json()) as {
        status: string;
        remainingSessions: number;
        debt: number;
      };

    await page.goto(`/contracts/${contract.id}`);
    await page.getByRole("tab", { name: historyTab }).click();
    await page.getByRole("button", { name: c.cancellation, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: fill(c.cancellationTitle, { code: contract.contractCode }) });
    await dialog.getByRole("combobox", { name: c.fields.cancelReason, exact: true }).click();
    await page.getByRole("listbox").getByRole("option", { name: OTHER_OPTION_LABEL, exact: true }).click();
    await dialog.getByLabel(labels.options.otherNote, { exact: true }).fill(`Chuyển nhà ${testTag}`);
    await dialog.getByLabel(c.fields.valueUsed, { exact: true }).fill("2000000");
    await dialog.getByLabel(c.fields.cancelFee, { exact: true }).fill("1000000");
    // A refund needs how it is paid and the expense type before anything is sent.
    await dialog.getByLabel(c.fields.refund, { exact: true }).fill("9000000");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(dialog.getByText(labels.validation.required).first()).toBeVisible();
    await dialog.getByLabel(c.fields.refund, { exact: true }).fill("0");
    await dialog.getByRole("button", { name: c.raise, exact: true }).click();
    await expect(
      page.getByRole("region", { name: labels.common.notifications }).getByText(c.raisedPending),
    ).toBeVisible();

    const table = page.getByRole("table", { name: c.title, exact: true });
    await expect(table.getByRole("row").nth(1)).toContainText(c.kinds.CANCELLATION);
    expect(await read()).toMatchObject({ status: "ACTIVE", remainingSessions: 24 });
    const listed = (await (await admin.get(`/api/v1/contract-changes?contractId=${contract.id}`)).json()) as {
      items: { id: string }[];
    };
    await approvePendingViaApi(admin, listed.items[0]!.id, "voucher.cancellation");
    expect(await read()).toMatchObject({ status: "CANCELLED", remainingSessions: 0, debt: 0 });

    // The cancelled contract takes no new voucher.
    await page.reload();
    await page.getByRole("tab", { name: historyTab }).click();
    await expect(page.getByRole("button", { name: c.cancellation, exact: true })).toHaveCount(0);
  });

  test("a refund becomes an expense voucher linked to the contract", async ({ apiAs, testTag }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const manager = await apiAs("FITNESS_MANAGER");
    await recordPaymentViaApi(manager, contract.id, "12000000", { approver: admin });
    const response = await manager.post("/api/v1/contract-changes/cancellations", {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: {
        contractId: contract.id,
        reasonId: await otherOptionId(manager, "cancelReasons"),
        reasonNote: `Lý do ${testTag}`,
        valueUsed: 2_000_000,
        fee: 1_000_000,
        refund: 9_000_000,
        refundMethodId: await otherOptionId(manager, "paymentMethods"),
        refundMethodNote: "E2E",
        refundCategoryId: await otherOptionId(manager, "expenseTypes"),
        refundCategoryNote: `Hoàn tiền ${testTag}`,
      },
    });
    expect(response.status()).toBe(202);
    const voucher = (await response.json()) as { id: string };
    await approvePendingViaApi(admin, voucher.id, "voucher.cancellation");
    const done = (await (await admin.get(`/api/v1/contract-changes/${voucher.id}`)).json()) as {
      status: string;
      refundVoucher: { id: string; number: string } | null;
    };
    expect(done.status).toBe("APPROVED");
    expect(done.refundVoucher?.number).toBeTruthy();
    const cash = (await (await admin.get("/api/v1/cash-transactions?type=EXPENSE&pageSize=100")).json()) as {
      items: { number: string; amount: number; contract: { id: string } | null }[];
    };
    expect(cash.items.find((item) => item.number === done.refundVoucher!.number)).toMatchObject({
      amount: 9_000_000,
      contract: { id: contract.id },
    });
  });
});

test.describe("who may raise a voucher", () => {
  test.describe("a PT", () => {
    test.use(signedInAs("PT"));

    test("sees no buttons and cannot raise one", async ({ page, apiAs, testTag }) => {
      const { contract } = await bookingSetup(apiAs, testTag);
      const response = await (
        await apiAs("PT")
      ).post("/api/v1/contract-changes/renewals", {
        headers: { "Idempotency-Key": crypto.randomUUID() },
        data: { contractId: contract.id, sessions: 1 },
      });
      expect(response.status()).toBe(403);
      await page.goto(`/contracts/${contract.id}`);
      await expect(page.getByRole("button", { name: c.renewal, exact: true })).toHaveCount(0);
    });
  });
});
