import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PARAMETER_DEFAULTS } from "@gymcrm/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { cancelBooking, getBooking, markNoShow } from "../../src/modules/bookings/booking.service.js";
import { listSessionStatuses, updateSessionStatus } from "../../src/modules/sessions/session-status.service.js";
import { checkIn, completeSession } from "../../src/modules/sessions/session.service.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { DEFAULT_BRANCH_ID, createTestUser, withoutApprovals } from "../support/factories.js";
import { resetDatabase } from "../support/database.js";
import { book, bookingScenario } from "../support/bookings.js";

afterEach(resetDatabase);
beforeEach(withoutApprovals);

const TRAINED = {
  labelVi: "Đã tập",
  labelEn: "Trained",
  consumes: true,
  creditsPt: true,
  locksOnSet: true,
  color: "info",
};
const NO_SHOW = {
  labelVi: "Khách không đến",
  labelEn: "No-show",
  consumes: true,
  creditsPt: true,
  locksOnSet: false,
  color: "warning",
};

describe("the session statuses (brief §6.2, D-025)", () => {
  it("start as the brief's table, in order", async () => {
    const { items } = await listSessionStatuses();

    expect(
      items.map((status) => [status.code, status.consumes, status.creditsPt, status.holdsSlot, status.color]),
    ).toEqual([
      ["BOOKED", false, false, true, "destructive"],
      ["TRAINED", true, true, true, "info"],
      ["CANCELLED", false, false, false, "muted"],
      ["NO_SHOW", true, true, true, "warning"],
      ["DELETED", false, false, false, "muted"],
    ]);
  });

  it("are edited by Admin only, with the change audited", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(updateSessionStatus(manager, "TRAINED", TRAINED)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const changed = await updateSessionStatus(admin, "NO_SHOW", { ...NO_SHOW, consumes: false, creditsPt: false });

    expect(changed).toMatchObject({ code: "NO_SHOW", consumes: false, creditsPt: false });
    expect(
      await prisma.auditEvent.findFirst({ where: { entityType: "session_status", action: "session_status.updated" } }),
    ).toMatchObject({
      before: { consumes: true, creditsPt: true },
      after: { consumes: false, creditsPt: false },
    });
    await expect(updateSessionStatus(admin, "NOPE", TRAINED)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuse a color outside the design tokens, and a Booked that consumes, credits, or locks", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    await expect(updateSessionStatus(admin, "TRAINED", { ...TRAINED, color: "#ff0000" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(
      updateSessionStatus(admin, "BOOKED", { ...TRAINED, labelVi: "Booked", labelEn: "Booked", color: "destructive" }),
    ).rejects.toMatchObject({ fieldErrors: { consumes: ["bookedNeverConsumes"] } });
  });
});

describe("a changed rule affects new status changes only (T-050)", () => {
  it("leaves a session with the flags it was given when its status was set", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN");
    const first = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const second = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await markNoShow(scenario.manager, first.id);

    await updateSessionStatus(admin, "NO_SHOW", { ...NO_SHOW, consumes: false, creditsPt: false });
    await markNoShow(scenario.manager, second.id);

    expect(await getBooking(scenario.manager, first.id)).toMatchObject({ consumes: true, creditsPt: true });
    expect(await getBooking(scenario.manager, second.id)).toMatchObject({ consumes: false, creditsPt: false });
    // Only the first used a session of the contract.
    expect(await getContract(scenario.manager, scenario.contract.id)).toMatchObject({
      completedSessions: 1,
      remainingSessions: 23,
    });
  });

  it("lets Đã tập stop consuming by configuration, and the contract follows", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN");
    await updateSessionStatus(admin, "TRAINED", { ...TRAINED, consumes: false });
    const booking = await book(scenario.manager, scenario);
    await checkIn(scenario.manager, booking.id);

    await completeSession(scenario.manager, booking.id);

    expect(await getContract(scenario.manager, scenario.contract.id)).toMatchObject({ remainingSessions: 24 });
  });

  it("keeps Đã tập locked once set (D-026)", async () => {
    const scenario = await bookingScenario();
    const booking = await book(scenario.manager, scenario);
    await checkIn(scenario.manager, booking.id);
    await completeSession(scenario.manager, booking.id);

    await expect(cancelBooking(scenario.manager, booking.id)).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
  });
});

describe("the cancel cut-off (BR-410, D-029)", () => {
  it("is off by default, and when on refuses a cancellation too close to the start", async () => {
    const scenario = await bookingScenario();
    const { actor: admin } = await createTestUser("ADMIN");
    const soon = new Date(Date.now() + 2 * 3_600_000);
    const booking = await prisma.booking.create({
      data: {
        branchId: DEFAULT_BRANCH_ID,
        customerId: scenario.customer.id,
        contractId: scenario.contract.id,
        trainerId: scenario.trainer.id,
        scheduledStart: soon,
        scheduledEnd: new Date(soon.getTime() + 3_600_000),
      },
    });

    await updateParameters(admin, { ...PARAMETER_DEFAULTS, cancelCutoffHours: "4" });
    await expect(cancelBooking(scenario.manager, booking.id)).rejects.toMatchObject({
      code: "BOOKING_CANCEL_TOO_LATE",
    });
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, cancelCutoffHours: "0" });

    expect(await cancelBooking(scenario.manager, booking.id)).toMatchObject({ status: "CANCELLED" });
  });
});
