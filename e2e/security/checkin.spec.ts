// OWASP A01 (access control, machine keys), A02 (secrets), A05/A10 (input errors) for the fingerprint-ready check-in
// of M5.3b (brief §6.6, D-069 to D-072). Route-level 401s are covered by the route inventory in access-control.spec.ts.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { bookingSetup, createBookingViaApi, gymDay } from "../support/data";
import type { Role } from "../support/db";

const KEY_SHAPE = /^fcd_[A-Za-z0-9_-]{40,}$/;

async function registerDevice(admin: APIRequestContext, tag: string) {
  const branches = await (await admin.get("/api/v1/me")).json();
  const response = await admin.post("/api/v1/checkin/devices", {
    data: { branchId: branches.branches[0].id, name: `Máy ${tag}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { device: { id: string }; key: string };
}

test.describe("A01 the machines and the review screens are for their roles", () => {
  const deviceRoles: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 403],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of deviceRoles) {
    test(`${role} listing the machines gets ${status}`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/checkin/devices")).status()).toBe(status);
    });
  }

  const reviewRoles: [Role, number][] = [
    ["ADMIN", 200],
    ["FITNESS_MANAGER", 200],
    ["RECEPTIONIST", 403],
    ["PT", 403],
    ["ACCOUNTANT", 403],
  ];
  for (const [role, status] of reviewRoles) {
    test(`${role} reading the scan errors and the manual report gets ${status}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      expect((await api.get("/api/v1/checkin/scans?result=ERROR")).status()).toBe(status);
      expect((await api.get("/api/v1/checkin/manual-confirmations")).status()).toBe(status);
    });
  }

  test("only Admin sets a machine user code, and one code cannot belong to two people", async ({ apiAs, testTag }) => {
    const { customer, trainer } = await bookingSetup(apiAs, testTag);
    const code = `C${testTag}`;

    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "PT"] as const) {
      const denied = await (
        await apiAs(role)
      ).put(`/api/v1/checkin/machine-codes/customer/${customer.id}`, { data: { code } });
      expect(denied.status(), role).toBe(403);
    }
    const admin = await apiAs("ADMIN");
    expect(
      (await admin.put(`/api/v1/checkin/machine-codes/customer/${customer.id}`, { data: { code } })).status(),
    ).toBe(200);
    const clash = await admin.put(`/api/v1/checkin/machine-codes/employee/${trainer.id}`, { data: { code } });
    expect(clash.status()).toBe(400);
    expect((await clash.json()).details.fieldErrors).toMatchObject({ code: ["machineCodeTaken"] });
    // Unknown kinds and malformed ids are not found; a control character is a field error.
    expect((await admin.get(`/api/v1/checkin/machine-codes/visitor/${customer.id}`)).status()).toBe(404);
    expect((await admin.get("/api/v1/checkin/machine-codes/customer/not-a-uuid")).status()).toBe(404);
    expect(
      (
        await admin.put(`/api/v1/checkin/machine-codes/customer/${customer.id}`, { data: { code: "a\u0007b" } })
      ).status(),
    ).toBe(400);
  });
});

test.describe("A07 a machine proves itself with its key, and nothing else gets in", () => {
  test("no key, a wrong key, a malformed key, a switched-off machine and a replaced key are all 401", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const { device, key } = await registerDevice(admin, testTag);
    expect(key).toMatch(KEY_SHAPE);
    const machine = await apiAs(null, { origin: null });
    const data = { scans: [{ userCode: `X${testTag}`, scannedAt: new Date().toISOString() }] };
    const send = (headers: Record<string, string>) => machine.post("/api/v1/checkin/scans", { headers, data });

    expect((await send({ "x-device-key": key })).status()).toBe(200);
    // With no key at all it is not a machine, and with no Origin either it is not a browser of the app: 403.
    expect((await send({})).status()).toBe(403);
    const wrong: Record<string, string>[] = [
      { "x-device-key": "" },
      { "x-device-key": "fcd_wrong" },
      { "x-device-key": `${key}x` },
    ];
    for (const headers of wrong) {
      const response = await send(headers);
      expect(response.status(), JSON.stringify(headers)).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    }
    await admin.patch(`/api/v1/checkin/devices/${device.id}`, { data: { name: `Máy ${testTag}`, active: false } });
    expect((await send({ "x-device-key": key })).status()).toBe(401);
  });

  test("a signed-in user is not a machine, and the key does not open any other route", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { key } = await registerDevice(admin, testTag);
    const data = { scans: [{ userCode: "X", scannedAt: new Date().toISOString() }] };

    // A browser session without the key is refused by the machine route's guard.
    expect((await admin.post("/api/v1/checkin/scans", { data })).status()).toBe(401);
    // The key is for the scan route only: a state change elsewhere still needs a session and the app's Origin.
    const machine = await apiAs(null, { origin: null });
    expect((await machine.post("/api/v1/customers", { headers: { "x-device-key": key }, data: {} })).status()).toBe(
      403,
    );
    expect((await machine.get("/api/v1/checkin/devices", { headers: { "x-device-key": key } })).status()).toBe(401);
    // A browser from another site cannot use it either: it sends a foreign Origin and no key.
    const foreign = await apiAs(null, { origin: "https://evil.example" });
    expect((await foreign.post("/api/v1/checkin/scans", { data })).status()).toBe(403);
  });

  test("the key is shown once and never comes back in a list, a read, or an update", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const { device, key } = await registerDevice(admin, testTag);

    const list = await (await admin.get("/api/v1/checkin/devices")).text();
    const update = await (
      await admin.patch(`/api/v1/checkin/devices/${device.id}`, { data: { name: `Máy ${testTag}`, active: true } })
    ).text();
    for (const body of [list, update]) {
      expect(body).not.toContain(key);
      expect(body).not.toMatch(/keyHash|key_hash|fcd_/);
    }
    const rotated = await (await admin.post(`/api/v1/checkin/devices/${device.id}/key`)).json();
    expect(rotated.key).toMatch(KEY_SHAPE);
    expect(rotated.key).not.toBe(key);
  });

  test("scans are validated: empty, oversized, malformed times and codes are 400, never a 500", async ({
    apiAs,
    testTag,
  }) => {
    const { key } = await registerDevice(await apiAs("ADMIN"), testTag);
    const machine = await apiAs(null, { origin: null });
    const send = (data: unknown) => machine.post("/api/v1/checkin/scans", { headers: { "x-device-key": key }, data });
    const scan = { userCode: "X1", scannedAt: new Date().toISOString() };

    for (const data of [
      {},
      { scans: [] },
      { scans: Array(501).fill(scan) },
      { scans: [{ ...scan, scannedAt: "yesterday" }] },
      { scans: [{ ...scan, userCode: "" }] },
      { scans: [{ ...scan, userCode: "x".repeat(41) }] },
      { scans: [{ ...scan, userCode: "a\u0000b" }] },
      { sentAt: "now", scans: [scan] },
    ]) {
      expect((await send(data)).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    // A scan of an unknown code is accepted and recorded as an error, not refused.
    const answer = await (await send({ scans: [scan] })).json();
    expect(answer.items[0]).toMatchObject({ result: "ERROR", errorCode: "UNKNOWN_USER" });
  });

  test("a PT sees only their own hanging sessions and cannot ask for another trainer's", async ({ apiAs, testTag }) => {
    const { refs } = await bookingSetup(apiAs, testTag);
    const booking = await createBookingViaApi(await apiAs("RECEPTIONIST"), refs, {
      date: gymDay(-1),
      startTime: "09:00",
      endTime: "10:00",
    });
    const pt = await apiAs("PT");

    expect((await (await pt.get("/api/v1/checkin/hanging")).json()).items).toEqual([]);
    expect((await pt.post(`/api/v1/checkin/hanging/${booking.id}/request`)).status()).toBe(404);
    expect((await pt.post("/api/v1/checkin/hanging/not-a-uuid/request")).status()).toBe(404);
    const manager = await apiAs("FITNESS_MANAGER");
    expect((await manager.post(`/api/v1/checkin/hanging/${booking.id}/request`)).status()).toBe(204);
    expect((await manager.post(`/api/v1/checkin/hanging/${booking.id}/request`)).status()).toBe(204);
    const listed = await (await manager.get("/api/v1/checkin/hanging")).json();
    expect(listed.items.find((row: { booking: { id: string } }) => row.booking.id === booking.id)).toMatchObject({
      requested: true,
    });
  });
});
