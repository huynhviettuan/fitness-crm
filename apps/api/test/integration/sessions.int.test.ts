import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Actor } from "../../src/platform/auth/session.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import { cancelBooking, markNoShow } from "../../src/modules/bookings/booking.service.js";
import { checkIn, completeSession } from "../../src/modules/sessions/session.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser } from "../support/factories.js";
import { book, bookingScenario, linkedTrainer } from "../support/bookings.js";

afterEach(async () => {
  await resetDatabase();
});

async function checkedInBooking(totalSessions = 24) {
  const scenario = await bookingScenario({ totalSessions });
  const booking = await book(scenario.manager, scenario);
  await checkIn(scenario.manager, booking.id);
  return { ...scenario, booking };
}

const remaining = (scenario: { manager: Actor; contract: { id: string } }) => getContract(scenario.manager, scenario.contract.id);

describe("checkIn", () => {
  it("records who checked in and does not consume a session (BR-005)", async () => {
    const scenario = await bookingScenario();
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const booking = await book(scenario.manager, scenario);

    const checkedIn = await checkIn(reception, booking.id);

    expect(checkedIn).toMatchObject({ status: "CHECKED_IN", session: { checkedInBy: "RECEPTIONIST test user", completedAt: null } });
    expect(await remaining(scenario)).toMatchObject({ completedSessions: 0, remainingSessions: 24 });
  });

  it("a repeat returns the current state and creates nothing more", async () => {
    const { manager, booking } = await checkedInBooking();

    expect(await checkIn(manager, booking.id)).toMatchObject({ status: "CHECKED_IN" });
    expect(await prisma.session.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: booking.id, action: "booking.checked_in" } })).toBe(1);
  });

  it("an accountant cannot check in", async () => {
    const scenario = await bookingScenario();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const booking = await book(scenario.manager, scenario);

    await expect(checkIn(accountant, booking.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("completeSession", () => {
  it("consumes exactly one session and returns the new remaining count (BR-006)", async () => {
    const scenario = await checkedInBooking();

    const result = await completeSession(scenario.manager, scenario.booking.id);

    expect(result.booking).toMatchObject({ status: "COMPLETED", session: { completedBy: "MANAGER test user" } });
    expect(result.contract).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    expect(await remaining(scenario)).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: scenario.booking.id, action: "booking.completed" } });
    expect(audit).toMatchObject({ actorUserId: scenario.manager.id, metadata: { remainingSessions: 23 } });
  });

  it("a repeated completion returns the same state and consumes nothing more (BR-007)", async () => {
    const scenario = await checkedInBooking();
    await completeSession(scenario.manager, scenario.booking.id);

    const again = await completeSession(scenario.manager, scenario.booking.id);

    expect(again.contract).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    expect(await prisma.auditEvent.count({ where: { entityId: scenario.booking.id, action: "booking.completed" } })).toBe(1);
  });

  it("10 simultaneous completions of one booking consume one session (INT-001)", async () => {
    const scenario = await checkedInBooking();

    const results = await Promise.all(Array.from({ length: 10 }, () => completeSession(scenario.manager, scenario.booking.id)));

    for (const result of results) {
      expect(result.booking.status).toBe("COMPLETED");
      expect(result.contract).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    }
    expect(await remaining(scenario)).toMatchObject({ completedSessions: 1, remainingSessions: 23 });
    expect(await prisma.auditEvent.count({ where: { entityId: scenario.booking.id, action: "booking.completed" } })).toBe(1);
  });

  it("two bookings racing for the last session: exactly one completes (INT-002, BR-009)", async () => {
    const scenario = await checkedInBooking(1);
    // A second checked-in booking on the same contract. OQ-008 interim refuses that
    // through the service, so it is written directly, as overbooking would allow.
    const second = await prisma.booking.create({
      data: {
        customerId: scenario.customer.id,
        contractId: scenario.contract.id,
        trainerId: scenario.trainer.id,
        scheduledStart: new Date("2026-10-15T13:00:00Z"),
        scheduledEnd: new Date("2026-10-15T14:00:00Z"),
        status: "CHECKED_IN",
        session: { create: { checkedInAt: new Date(), checkedInById: scenario.manager.id } },
      },
    });

    const results = await Promise.allSettled([
      completeSession(scenario.manager, scenario.booking.id),
      completeSession(scenario.manager, second.id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONTRACT_NO_REMAINING_SESSIONS" } });
    expect(await remaining(scenario)).toMatchObject({ completedSessions: 1, remainingSessions: 0 });
  });

  it("counts sessions used before go-live (D-011)", async () => {
    const scenario = await checkedInBooking(10);
    await prisma.contract.update({ where: { id: scenario.contract.id }, data: { openingSessionsUsed: 10 } });

    await expect(completeSession(scenario.manager, scenario.booking.id)).rejects.toMatchObject({
      code: "CONTRACT_NO_REMAINING_SESSIONS",
    });
    expect((await remaining(scenario)).remainingSessions).toBe(0);
  });

  it("completes only a checked-in booking (OQ-002 interim)", async () => {
    const scenario = await bookingScenario();
    const booked = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const noShow = await book(scenario.manager, scenario, { startTime: "09:00", endTime: "10:00" });
    const cancelled = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await markNoShow(scenario.manager, noShow.id);
    await checkIn(scenario.manager, cancelled.id);
    await cancelBooking(scenario.manager, cancelled.id);

    for (const booking of [booked, noShow, cancelled]) {
      await expect(completeSession(scenario.manager, booking.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    }
    expect(await remaining(scenario)).toMatchObject({ completedSessions: 0, remainingSessions: 24 });
  });

  it("a receptionist cannot complete (OQ-011, T-024)", async () => {
    const scenario = await checkedInBooking();
    const { actor: reception } = await createTestUser("RECEPTIONIST");

    await expect(completeSession(reception, scenario.booking.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a trainer completes their own session but cannot see another trainer's (A-007)", async () => {
    const scenario = await bookingScenario();
    const { actor: trainer, trainer: own } = await linkedTrainer(scenario.manager);
    const mine = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" }, own.id);
    const theirs = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await checkIn(trainer, mine.id);
    await checkIn(scenario.manager, theirs.id);

    expect((await completeSession(trainer, mine.id)).contract.remainingSessions).toBe(23);
    await expect(completeSession(trainer, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
