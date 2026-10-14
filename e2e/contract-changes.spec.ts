import { expect, signedInAs, test } from "./fixtures";
import { approvePendingViaApi } from "./support/approvals";
import { bookingSetup, createBookingViaApi } from "./support/data";
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
