import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { completeSession } from "../../src/modules/sessions/session.service.js";
import {
  escalateHangingSessions,
  getMachineCode,
  listHanging,
  listScans,
  manualConfirmationReport,
  requestManualConfirmation,
  setMachineCode,
} from "../../src/modules/checkin/checkin.service.js";
import {
  authenticateDevice,
  createDevice,
  rotateDeviceKey,
  updateDevice,
} from "../../src/modules/checkin/device.service.js";
import { receiveScans } from "../../src/modules/checkin/scan.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, DEFAULT_BRANCH_ID } from "../support/factories.js";
import { book, bookingScenario, createTrainer } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});

// 15/10/2026 in the gym is UTC+7: a session at 18:00–19:00 is 11:00Z–12:00Z.
const at = (time: string) => `2026-10-15T${time}:00.000Z`;

async function setup(options: { sessions?: number } = {}) {
  const scenario = await bookingScenario(options);
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { device, key } = await createDevice(admin, { branchId: DEFAULT_BRANCH_ID, name: "Cổng chính" });
  await setMachineCode(admin, "customer", scenario.customer.id, { code: "C100" });
  await setMachineCode(admin, "employee", scenario.trainer.id, { code: "E100" });
  const authenticated = (await authenticateDevice(key))!;
  const booking = await book(scenario.manager, scenario, { startTime: "18:00", endTime: "19:00" });
  const scan = (userCode: string, time: string) =>
    receiveScans(authenticated, { scans: [{ userCode, scannedAt: at(time) }] });
  return { ...scenario, admin, device, key, authenticated, booking, scan };
}

describe("devices (D-072)", () => {
  it("registers a machine, shows its key once, keeps only a hash, and a rotated key replaces the old one", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { device, key } = await createDevice(admin, { branchId: DEFAULT_BRANCH_ID, name: "Cổng" });

    expect(key).toMatch(/^fcd_/);
    const row = await prisma.checkinDevice.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.keyHash).not.toContain(key);
    expect(await authenticateDevice(key)).toMatchObject({ id: device.id, branchId: DEFAULT_BRANCH_ID });

    const { key: next } = await rotateDeviceKey(admin, device.id);
    expect(await authenticateDevice(key)).toBeNull();
    expect(await authenticateDevice(next)).not.toBeNull();

    await updateDevice(admin, device.id, { name: "Cổng", active: false });
    expect(await authenticateDevice(next)).toBeNull();
    expect(await authenticateDevice("fcd_notakey-notakey-notakey-notakey")).toBeNull();
    expect(await authenticateDevice("")).toBeNull();
  });

  it("is Admin's only", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await expect(createDevice(manager, { branchId: DEFAULT_BRANCH_ID, name: "Cổng" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(setMachineCode(manager, "customer", crypto.randomUUID(), { code: "X" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("keeps one machine user code for one person across customers and staff", async () => {
    const { admin, customer, trainer } = await setup();
    const other = await createTrainer(admin, { fullName: "PT Lan" });

    await expect(setMachineCode(admin, "employee", other.id, { code: "C100" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { code: ["machineCodeTaken"] },
    });
    await expect(setMachineCode(admin, "employee", trainer.id, { code: "E100" })).resolves.toEqual({ code: "E100" });
    await setMachineCode(admin, "customer", customer.id, { code: "" });
    expect(await getMachineCode(admin, "customer", customer.id)).toEqual({ code: null });
  });
});

describe("pairing scans (D-069, D-070)", () => {
  it("confirms the session when the customer and the booked PT scan within 15 minutes, once, by device", async () => {
    const s = await setup();

    expect((await s.scan("C100", "10:55")).items[0]).toMatchObject({ result: "WAITING", bookingId: s.booking.id });
    expect((await s.scan("E100", "10:58")).items[0]).toMatchObject({ result: "PAIRED", bookingId: s.booking.id });

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: s.booking.id }, include: { session: true } });
    expect(booking).toMatchObject({ status: "TRAINED", consumes: true, creditsPt: true, statusSetById: null });
    expect(booking.session).toMatchObject({ confirmationMethod: "DEVICE", checkedInById: null, completedById: null });
    expect(await getContract(s.manager, s.contract.id)).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    const results = await prisma.checkinScan.findMany({ select: { result: true } });
    expect(results.map((r) => r.result)).toEqual(["PAIRED", "PAIRED"]);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: s.booking.id, action: "booking.completed" } });
    expect(audit).toMatchObject({ actorUserId: null, metadata: expect.objectContaining({ method: "DEVICE" }) });
  });

  it("pairs whichever side scans first, and offline scans in one batch by their real time", async () => {
    const s = await setup();

    const answer = await receiveScans(s.authenticated, {
      scans: [
        { userCode: "C100", scannedAt: at("11:05") },
        { userCode: "E100", scannedAt: at("10:50") },
      ],
    });

    expect(answer.items.map((item) => item.result)).toEqual(["WAITING", "PAIRED"]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: s.booking.id } })).status).toBe("TRAINED");
  });

  it("refuses a second scan more than 15 minutes after the first, and the session hangs for the missing side", async () => {
    const s = await setup();

    await s.scan("C100", "10:55");
    expect((await s.scan("E100", "11:11")).items[0]).toMatchObject({ result: "ERROR", errorCode: "PAIR_TOO_LATE" });

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: s.booking.id } })).status).toBe("BOOKED");
    const hanging = await listHanging(s.manager, new Date(at("12:30")));
    expect(hanging.items).toHaveLength(1);
    expect(hanging.items[0]).toMatchObject({ reason: "PT_MISSING", requested: false });
    // While the other side may still come, it is not hanging yet.
    expect((await listHanging(s.manager, new Date(at("11:00")))).items).toHaveLength(0);
  });

  it("makes a scan with no booked session, or from an unknown person, an error with nothing taken", async () => {
    const s = await setup();

    expect((await s.scan("C100", "07:00")).items[0]).toMatchObject({ result: "ERROR", errorCode: "NO_BOOKING" });
    expect((await s.scan("Z999", "11:00")).items[0]).toMatchObject({ result: "ERROR", errorCode: "UNKNOWN_USER" });
    expect(await getContract(s.manager, s.contract.id)).toMatchObject({ completedSessions: 0 });
    const errors = await listScans(s.admin, { result: "ERROR" });
    expect(errors.items.map((scan) => scan.errorCode).sort()).toEqual(["NO_BOOKING", "UNKNOWN_USER"]);
    expect(errors.items.find((scan) => scan.errorCode === "NO_BOOKING")?.subject).toMatchObject({ type: "CUSTOMER" });
  });

  it("counts a repeat scan within seconds once, and answers a resent batch from the stored scans", async () => {
    const s = await setup();

    await s.scan("C100", "10:55");
    const repeat = await receiveScans(s.authenticated, {
      scans: [{ userCode: "C100", scannedAt: "2026-10-15T10:55:05.000Z" }],
    });
    expect(repeat.items[0]).toMatchObject({ result: "REPEAT" });
    // The machine resends the first scan: same answer, no second row.
    expect((await s.scan("C100", "10:55")).items[0]).toMatchObject({ result: "WAITING" });
    expect(await prisma.checkinScan.count()).toBe(2);
    expect((await s.scan("E100", "10:58")).items[0]).toMatchObject({ result: "PAIRED" });
    expect(await getContract(s.manager, s.contract.id)).toMatchObject({ completedSessions: 1 });
  });

  it("needs its own pair for each of two sessions a day with different PTs, nearest first", async () => {
    const s = await setup();
    const second = await createTrainer(s.admin, { fullName: "PT Lan" });
    await setMachineCode(s.admin, "employee", second.id, { code: "E200" });
    const later = await book(s.manager, s, { startTime: "19:00", endTime: "20:00" }, second.id);

    // One scan of the customer serves one session: the 18:00 one, the nearest to 17:58.
    expect((await s.scan("C100", "10:58")).items[0]).toMatchObject({ bookingId: s.booking.id });
    expect((await s.scan("E200", "11:59")).items[0]).toMatchObject({ result: "WAITING", bookingId: later.id });
    expect((await s.scan("E100", "11:00")).items[0]).toMatchObject({ result: "PAIRED", bookingId: s.booking.id });
    // The second session needs a new scan of the customer; the first scan is not reused.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("BOOKED");
    expect((await s.scan("C100", "11:58")).items[0]).toMatchObject({ result: "PAIRED", bookingId: later.id });
    expect(await getContract(s.manager, s.contract.id)).toMatchObject({ completedSessions: 2, remainingSessions: 22 });
  });

  it("makes a scan on a deactivated contract an error and takes nothing", async () => {
    const s = await setup();
    await prisma.contract.update({ where: { id: s.contract.id }, data: { status: "FROZEN" } });

    expect((await s.scan("C100", "10:55")).items[0]).toMatchObject({ result: "ERROR", errorCode: "CONTRACT_FROZEN" });
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: s.booking.id } })).customerScanId).toBeNull();
  });

  it("lets only one of two scans that complete the pair together confirm, consuming once", async () => {
    const s = await setup();
    await s.scan("C100", "10:55");

    const [first, second] = await Promise.all([s.scan("E100", "10:58"), s.scan("E100", "10:59")]);

    const results = [first.items[0].result, second.items[0].result].sort();
    expect(results).toEqual(["ERROR", "PAIRED"]);
    expect(await getContract(s.manager, s.contract.id)).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
  });

  it("does not confirm a session that was completed by hand meanwhile, and a manual one is not paired again", async () => {
    const s = await setup();
    await completeSession(s.manager, s.booking.id);

    expect((await s.scan("C100", "10:55")).items[0]).toMatchObject({ result: "ERROR", errorCode: "NO_BOOKING" });
    expect(await getContract(s.manager, s.contract.id)).toMatchObject({ completedSessions: 1 });
  });
});

describe("clock, hanging sessions and the manual report (D-071, D-072)", () => {
  it("warns when a machine's clock is off and records its last report", async () => {
    const s = await setup();

    const answer = await receiveScans(
      s.authenticated,
      { sentAt: "2026-10-15T09:00:00.000Z", scans: [{ userCode: "C100", scannedAt: at("10:55") }] },
      new Date("2026-10-15T09:10:00.000Z"),
    );

    expect(answer.clockOff).toBe(true);
    expect(await prisma.checkinDevice.findUniqueOrThrow({ where: { id: s.device.id } })).toMatchObject({
      clockOffsetSeconds: -600,
    });
  });

  it("lets a PT ask the admin to confirm, and the admin's manual confirmation shows in the report per PT and customer", async () => {
    const s = await setup();

    await requestManualConfirmation(s.manager, s.booking.id);
    await requestManualConfirmation(s.manager, s.booking.id);
    const listed = await listHanging(s.manager, new Date(at("12:30")));
    expect(listed.items).toEqual([expect.objectContaining({ reason: null, requested: true })]);
    expect(await prisma.auditEvent.count({ where: { action: "booking.scan_requested" } })).toBe(1);

    await completeSession(s.manager, s.booking.id);
    const report = await manualConfirmationReport(s.manager, {});
    expect(report).toMatchObject({
      total: 1,
      perTrainer: [{ id: s.trainer.id, name: "PT Minh", sessions: 1 }],
      perCustomer: [{ id: s.customer.id, sessions: 1 }],
    });
  });

  it("reports a session still hanging after the escalation hours once, to the reviewers", async () => {
    const s = await setup();
    await s.scan("C100", "10:55");

    expect(await escalateHangingSessions(new Date(at("12:30")))).toBe(0);
    const next = new Date("2026-10-16T13:00:00.000Z");
    expect(await escalateHangingSessions(next)).toBe(1);
    expect(await escalateHangingSessions(next)).toBe(0);
    expect(await prisma.notification.count({ where: { kind: "sessionHanging" } })).toBeGreaterThan(0);
  });

  it("is reviewed by Admin and Fitness Manager, not by a receptionist", async () => {
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    await expect(listScans(reception, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manualConfirmationReport(reception, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

export type { Actor };
