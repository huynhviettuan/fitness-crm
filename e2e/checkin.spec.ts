import { expect, signedInAs, test } from "./fixtures";
import { bookingSetup, createBookingViaApi, gymDay } from "./support/data";
import { labels } from "./support/labels";

// Fingerprint-ready check-in (M5.3b, brief §6.6, D-069 to D-072; docs/13 E2E-169): the machines, the pairing through the
// scan API, the hanging sessions and the scan errors.
const c = labels.checkin;

/** Yesterday's gym day as the yyyy-MM-dd the scan API takes, so the waiting time has long passed. */
const yesterday = () => gymDay(-1).split("/").reverse().join("-");

test.describe("check-in as admin", () => {
  test.use(signedInAs("ADMIN"));

  test("E2E-169: a machine is registered, its scans pair a session, a lone scan hangs, and the admin settles it", async ({
    page,
    apiAs,
    testTag,
    checkinPage,
  }) => {
    const { customer, refs, trainer } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const customerCode = `C${testTag}`;
    const trainerCode = `E${testTag}`;
    expect(
      (await admin.put(`/api/v1/checkin/machine-codes/employee/${trainer.id}`, { data: { code: trainerCode } })).ok(),
    ).toBe(true);

    // The machine's code for the customer is set on the customer's page.
    await page.goto(`/customers/${customer.id}`);
    await checkinPage.setMachineCode(customerCode);
    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(c.codeSaved)).toBeVisible();

    // Register the machine; its key is shown once.
    await checkinPage.goto("devices");
    const key = await checkinPage.addDevice(`Cổng ${testTag}`);
    expect(key).toMatch(/^fcd_/);
    await expect(checkinPage.row(`Cổng ${testTag}`)).toContainText(c.deviceActive);

    // Two sessions yesterday: one the pair confirms, one only the customer scanned.
    const day = yesterday();
    const date = gymDay(-1);
    const reception = await apiAs("RECEPTIONIST");
    const paired = await createBookingViaApi(reception, refs, { date, startTime: "09:00", endTime: "10:00" });
    const hanging = await createBookingViaApi(reception, refs, { date, startTime: "11:00", endTime: "12:00" });
    const machine = await apiAs(null, { origin: null });
    const send = (scans: { userCode: string; scannedAt: string }[]) =>
      machine.post("/api/v1/checkin/scans", { headers: { "x-device-key": key }, data: { scans } });
    // 09:00 and 11:00 in the gym are 02:00Z and 04:00Z.
    expect((await send([{ userCode: customerCode, scannedAt: `${day}T01:58:00Z` }])).ok()).toBe(true);
    const answer = await (await send([{ userCode: trainerCode, scannedAt: `${day}T02:00:00Z` }])).json();
    expect(answer.items[0]).toMatchObject({ result: "PAIRED", bookingId: paired.id });
    await send([{ userCode: customerCode, scannedAt: `${day}T03:58:00Z` }]);
    await send([{ userCode: `X${testTag}`, scannedAt: `${day}T05:00:00Z` }]);

    await checkinPage.goto();
    await expect(checkinPage.row(customer.fullName)).toContainText(c.reasons.PT_MISSING);
    await expect(checkinPage.row(customer.fullName)).toHaveCount(1);
    await checkinPage.action(customer.fullName, c.actions.complete).click();
    await expect(page.getByRole("region", { name: labels.common.notifications }).getByText(c.completed)).toBeVisible();
    await expect(checkinPage.row(customer.fullName)).toHaveCount(0);

    // The unknown code is an error with its reason.
    await checkinPage.goto("errors");
    await expect(checkinPage.row(`X${testTag}`)).toContainText(c.scanErrors.UNKNOWN_USER);

    const manager = await apiAs("FITNESS_MANAGER");
    const status = async (id: string) =>
      (await (await manager.get(`/api/v1/bookings/${id}`)).json()) as {
        status: string;
        session: { confirmationMethod: string };
      };
    expect(await status(paired.id)).toMatchObject({ status: "TRAINED", session: { confirmationMethod: "DEVICE" } });
    expect(await status(hanging.id)).toMatchObject({ status: "TRAINED", session: { confirmationMethod: "MANUAL" } });
  });

  test("a machine's key can be replaced, and the old key stops working", async ({ apiAs, testTag, checkinPage }) => {
    await checkinPage.goto("devices");
    const key = await checkinPage.addDevice(`Cổng ${testTag}`);
    const machine = await apiAs(null, { origin: null });
    const send = (withKey: string) =>
      machine.post("/api/v1/checkin/scans", {
        headers: { "x-device-key": withKey },
        data: { scans: [{ userCode: `X${testTag}`, scannedAt: new Date().toISOString() }] },
      });
    expect((await send(key)).status()).toBe(200);

    await checkinPage.action(`Cổng ${testTag}`, c.newKey).click();
    const next = await checkinPage.readKey();

    expect((await send(key)).status()).toBe(401);
    expect((await send(next)).status()).toBe(200);
  });
});
