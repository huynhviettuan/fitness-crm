import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { createCustomer, getCustomer, listCustomers } from "../../src/modules/customers/customer.service.js";
import {
  cancelContract,
  createContract,
  getContract,
  listContracts,
} from "../../src/modules/contracts/contract.service.js";
import {
  addDayOff,
  createEmployee,
  replaceShifts,
  updateEmployee,
} from "../../src/modules/employees/employee.service.js";
import {
  cancelBooking,
  getBooking,
  listBookings,
  listDayBookings,
  markNoShow,
  rescheduleBooking,
} from "../../src/modules/bookings/booking.service.js";
import { checkIn, completeSession } from "../../src/modules/sessions/session.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, DEFAULT_BRANCH_ID } from "../support/factories.js";
import {
  activeContract,
  book,
  bookingScenario,
  contractInput,
  createTrainer,
  linkedTrainer,
} from "../support/bookings.js";

afterEach(async () => {
  vi.useRealTimers();
  await resetDatabase();
});

describe("createBooking", () => {
  it("books without consuming a session (BR-004), stores gym-time instants, and audits", async () => {
    const scenario = await bookingScenario();

    const booking = await book(scenario.manager, scenario, {
      date: "15/10/2026",
      startTime: "18:00",
      endTime: "19:00",
    });

    expect(booking).toMatchObject({
      status: "BOOKED",
      // 18:00 in the gym (UTC+7, A-001).
      scheduledStart: new Date("2026-10-15T11:00:00Z"),
      scheduledEnd: new Date("2026-10-15T12:00:00Z"),
      customer: { id: scenario.customer.id },
      trainer: { id: scenario.trainer.id },
      contract: { id: scenario.contract.id, remainingSessions: 24 },
      session: null,
    });
    expect(await getContract(scenario.manager, scenario.contract.id)).toMatchObject({
      completedSessions: 0,
      remainingSessions: 24,
    });
    const audit = await prisma.auditEvent.findMany({ where: { entityId: booking.id } });
    expect(audit).toEqual([expect.objectContaining({ action: "booking.created", actorUserId: scenario.manager.id })]);
  });

  it("returns field errors for invalid input (BR-011)", async () => {
    const scenario = await bookingScenario();

    await expect(book(scenario.manager, scenario, { startTime: "19:00", endTime: "18:00" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { endTime: ["endTimeNotAfterStart"] },
    });
    await expect(book(scenario.manager, scenario, { date: "31/02/2026", startTime: "25:00" })).rejects.toMatchObject({
      fieldErrors: { date: ["invalidDate"], startTime: ["invalidTime"] },
    });
    await expect(book(scenario.manager, scenario, {}, "")).rejects.toMatchObject({
      fieldErrors: { trainerId: ["required"] },
    });
    expect(await prisma.booking.count()).toBe(0);
  });

  it("refuses a contract owned by another customer (OQ-010 interim)", async () => {
    const scenario = await bookingScenario();
    const other = await createCustomer(scenario.manager, { fullName: "Lê Thị Hoa", phone: "0388777666" });

    await expect(book(scenario.manager, { ...scenario, customer: other })).rejects.toMatchObject({
      code: "BOOKING_CUSTOMER_CONTRACT_MISMATCH",
    });
  });

  it("refuses a contract that is not active (BR-003)", async () => {
    const scenario = await bookingScenario();
    const { contract: draft } = await createContract(
      scenario.manager,
      scenario.customer.id,
      await contractInput(),
      crypto.randomUUID(),
    );
    const cancelled = await activeContract(scenario.manager, scenario.customer.id);
    await cancelContract(scenario.manager, cancelled.id);

    for (const contract of [draft, cancelled]) {
      await expect(book(scenario.manager, { ...scenario, contract })).rejects.toMatchObject({
        code: "CONTRACT_NOT_ACTIVE",
      });
    }
  });

  it("refuses an expired contract, judged by the gym's clock (T-018)", async () => {
    const scenario = await bookingScenario();
    const contract = await activeContract(scenario.manager, scenario.customer.id, {}, { months: 1 });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T17:00:00Z")); // 00:00 on 01/11 in the gym
    await expect(book(scenario.manager, { ...scenario, contract }, { date: "31/10/2026" })).rejects.toMatchObject({
      code: "CONTRACT_NOT_ACTIVE",
    });
  });

  it("refuses a day outside the contract's dates (BR-012, OQ-001 interim)", async () => {
    const scenario = await bookingScenario();

    for (const date of ["30/09/2026", "01/10/2031"]) {
      await expect(book(scenario.manager, scenario, { date })).rejects.toMatchObject({
        code: "BOOKING_OUTSIDE_CONTRACT_PERIOD",
      });
    }
    await expect(book(scenario.manager, scenario, { date: "01/10/2026" })).resolves.toBeDefined();
    await expect(book(scenario.manager, scenario, { date: "30/09/2031" })).resolves.toBeDefined();
  });

  it("refuses an inactive trainer", async () => {
    const scenario = await bookingScenario();
    await updateEmployee(scenario.manager, scenario.trainer.id, {
      fullName: "PT Minh",
      isTrainer: true,
      status: "INACTIVE",
    });

    await expect(book(scenario.manager, scenario)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { trainerId: ["trainerUnavailable"] },
    });
  });

  it("refuses an employee who does not teach PT", async () => {
    const scenario = await bookingScenario();
    const receptionist = await createEmployee(scenario.manager, { fullName: "Lễ tân Hồng" });

    await expect(book(scenario.manager, scenario, {}, receptionist.id)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { trainerId: ["trainerUnavailable"] },
    });
  });

  describe("working hours (D-030)", () => {
    // 15/10/2026 is a Thursday (ISO weekday 4).
    const narrow = (scenario: Awaited<ReturnType<typeof bookingScenario>>) =>
      replaceShifts(scenario.manager, scenario.trainer.id, {
        shifts: [
          { weekday: 4, start: "08:00", end: "12:00" },
          { weekday: 4, start: "12:00", end: "14:00" },
          { weekday: 4, start: "17:00", end: "21:00" },
        ],
      });

    it("books only inside the trainer's shifts of the day, across touching shifts but not a break", async () => {
      const scenario = await bookingScenario();
      await narrow(scenario);

      await expect(book(scenario.manager, scenario, { startTime: "11:30", endTime: "12:30" })).resolves.toBeDefined();
      await expect(book(scenario.manager, scenario, { startTime: "20:00", endTime: "21:00" })).resolves.toBeDefined();
      for (const [startTime, endTime] of [
        ["07:30", "08:30"],
        ["13:30", "17:30"],
        ["20:30", "21:30"],
      ]) {
        await expect(book(scenario.manager, scenario, { startTime, endTime })).rejects.toMatchObject({
          code: "BOOKING_OUTSIDE_WORKING_HOURS",
        });
      }
      // Friday has no shifts at all.
      await expect(book(scenario.manager, scenario, { date: "16/10/2026" })).rejects.toMatchObject({
        code: "BOOKING_OUTSIDE_WORKING_HOURS",
      });
    });

    it("refuses a day off and a reschedule out of the working hours", async () => {
      const scenario = await bookingScenario();
      await narrow(scenario);
      const booking = await book(scenario.manager, scenario, { startTime: "09:00", endTime: "10:00" });
      await addDayOff(scenario.manager, scenario.trainer.id, { date: "22/10/2026" });

      await expect(
        book(scenario.manager, scenario, { date: "22/10/2026", startTime: "09:00", endTime: "10:00" }),
      ).rejects.toMatchObject({
        code: "BOOKING_OUTSIDE_WORKING_HOURS",
      });
      await expect(
        rescheduleBooking(scenario.manager, booking.id, {
          trainerId: scenario.trainer.id,
          date: "15/10/2026",
          startTime: "15:00",
          endTime: "16:00",
        }),
      ).rejects.toMatchObject({ code: "BOOKING_OUTSIDE_WORKING_HOURS" });
    });

    it("leaves bookings already made when the shifts change (A-042)", async () => {
      const scenario = await bookingScenario();
      const booking = await book(scenario.manager, scenario, { startTime: "06:00", endTime: "07:00" });

      await narrow(scenario);

      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("BOOKED");
    });
  });

  it("refuses more open bookings than remaining sessions (OQ-008 interim)", async () => {
    const scenario = await bookingScenario({ sessions: 2 });
    const first = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    await book(scenario.manager, scenario, { startTime: "09:00", endTime: "10:00" });

    await expect(book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" })).rejects.toMatchObject({
      code: "CONTRACT_NO_REMAINING_SESSIONS",
    });

    await cancelBooking(scenario.manager, first.id);
    await expect(book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" })).resolves.toBeDefined();
  });

  it("lets only one of several simultaneous bookings take a contract's last session", async () => {
    const scenario = await bookingScenario({ sessions: 1 });
    const hours = ["08", "09", "10", "11", "12"];

    const results = await Promise.allSettled(
      hours.map((h) => book(scenario.manager, scenario, { startTime: `${h}:00`, endTime: `${h}:30` })),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect(r).toMatchObject({ reason: { code: "CONTRACT_NO_REMAINING_SESSIONS" } });
    }
  });
});

describe("trainer overlap (BR-010)", () => {
  it("refuses an overlapping active booking, and allows back-to-back and other trainers", async () => {
    const scenario = await bookingScenario();
    const other = await createTrainer(scenario.manager, { fullName: "PT Lan" });
    await book(scenario.manager, scenario, { startTime: "18:00", endTime: "19:00" });

    await expect(book(scenario.manager, scenario, { startTime: "18:30", endTime: "19:30" })).rejects.toMatchObject({
      code: "BOOKING_TRAINER_OVERLAP",
    });
    // A-004: half-open ranges.
    await expect(book(scenario.manager, scenario, { startTime: "19:00", endTime: "20:00" })).resolves.toBeDefined();
    await expect(
      book(scenario.manager, scenario, { startTime: "18:30", endTime: "19:30" }, other.id),
    ).resolves.toBeDefined();
  });

  it("a cancelled or no-show booking frees the slot; a completed one does not (A-005)", async () => {
    const scenario = await bookingScenario();
    const cancelled = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const noShow = await book(scenario.manager, scenario, { startTime: "09:00", endTime: "10:00" });
    const completed = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await cancelBooking(scenario.manager, cancelled.id);
    await markNoShow(scenario.manager, noShow.id);
    await checkIn(scenario.manager, completed.id);
    await completeSession(scenario.manager, completed.id);

    await expect(book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" })).resolves.toBeDefined();
    await expect(book(scenario.manager, scenario, { startTime: "09:00", endTime: "10:00" })).resolves.toBeDefined();
    await expect(book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" })).rejects.toMatchObject({
      code: "BOOKING_TRAINER_OVERLAP",
    });
  });

  it("creates exactly one of two overlapping bookings sent at the same time (INT-003)", async () => {
    // Two customers, so the requests do not queue on one contract lock: the database
    // constraint alone has to decide.
    const scenario = await bookingScenario();
    const second = await createCustomer(scenario.manager, { fullName: "Lê Thị Hoa", phone: "0388777666" });
    const secondContract = await activeContract(scenario.manager, second.id);

    const results = await Promise.allSettled([
      book(scenario.manager, scenario, { startTime: "18:00", endTime: "19:00" }),
      book(
        scenario.manager,
        { ...scenario, customer: second, contract: secondContract },
        { startTime: "18:30", endTime: "19:30" },
      ),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "BOOKING_TRAINER_OVERLAP" } });
    expect(await prisma.booking.count()).toBe(1);
  });

  it("the exclusion constraint exists and holds even without the service (INT-007)", async () => {
    const [constraint] = await prisma.$queryRaw<{ contype: string }[]>`
      SELECT contype::text AS contype FROM pg_constraint WHERE conname = 'booking_trainer_no_overlap'`;
    expect(constraint?.contype).toBe("x");

    const scenario = await bookingScenario();
    const existing = await book(scenario.manager, scenario, { startTime: "18:00", endTime: "19:00" });
    await expect(
      prisma.booking.create({
        data: {
          branchId: DEFAULT_BRANCH_ID,
          customerId: scenario.customer.id,
          contractId: scenario.contract.id,
          trainerId: scenario.trainer.id,
          scheduledStart: new Date(existing.scheduledStart.getTime() + 30 * 60_000),
          scheduledEnd: new Date(existing.scheduledEnd.getTime() + 30 * 60_000),
        },
      }),
    ).rejects.toThrow(/booking_trainer_no_overlap/);
    await expect(
      prisma.booking.create({
        data: {
          branchId: DEFAULT_BRANCH_ID,
          customerId: scenario.customer.id,
          contractId: scenario.contract.id,
          trainerId: scenario.trainer.id,
          scheduledStart: existing.scheduledEnd,
          scheduledEnd: existing.scheduledStart,
        },
      }),
    ).rejects.toThrow(/bookings_time_ordered/);
  });
});

describe("rescheduleBooking", () => {
  it("moves a BOOKED booking, ignoring its own old slot, and audits the change", async () => {
    const scenario = await bookingScenario();
    const booking = await book(scenario.manager, scenario, { startTime: "18:00", endTime: "19:00" });

    const moved = await rescheduleBooking(scenario.manager, booking.id, {
      trainerId: scenario.trainer.id,
      date: "15/10/2026",
      startTime: "18:30",
      endTime: "19:30",
    });

    expect(moved.scheduledStart).toEqual(new Date("2026-10-15T11:30:00Z"));
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: booking.id, action: "booking.rescheduled" } });
    expect(audit).toMatchObject({
      before: { scheduledStart: "2026-10-15T11:00:00.000Z" },
      after: { scheduledStart: "2026-10-15T11:30:00.000Z" },
    });
  });

  it("re-checks overlap, and only a BOOKED booking can move (A-006)", async () => {
    const scenario = await bookingScenario();
    const first = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const second = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    const move = (id: string, startTime: string, endTime: string) =>
      rescheduleBooking(scenario.manager, id, {
        trainerId: scenario.trainer.id,
        date: "15/10/2026",
        startTime,
        endTime,
      });

    await expect(move(second.id, "08:30", "09:30")).rejects.toMatchObject({ code: "BOOKING_TRAINER_OVERLAP" });
    await checkIn(scenario.manager, first.id);
    await expect(move(first.id, "12:00", "13:00")).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });
});

describe("cancel and no-show", () => {
  it("neither consumes a session (BR-008), and a repeat returns the current state", async () => {
    const scenario = await bookingScenario();
    const a = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const b = await book(scenario.manager, scenario, { startTime: "09:00", endTime: "10:00" });

    expect(await cancelBooking(scenario.manager, a.id)).toMatchObject({ status: "CANCELLED" });
    expect(await cancelBooking(scenario.manager, a.id)).toMatchObject({ status: "CANCELLED" });
    expect(await markNoShow(scenario.manager, b.id)).toMatchObject({ status: "NO_SHOW" });
    expect(await markNoShow(scenario.manager, b.id)).toMatchObject({ status: "NO_SHOW" });

    expect(await getContract(scenario.manager, scenario.contract.id)).toMatchObject({
      completedSessions: 0,
      remainingSessions: 24,
    });
    expect(
      await prisma.auditEvent.count({ where: { entityId: { in: [a.id, b.id] }, action: { not: "booking.created" } } }),
    ).toBe(2);
  });

  it("allows only the transitions in A-006", async () => {
    const scenario = await bookingScenario();
    const booking = await book(scenario.manager, scenario);
    await checkIn(scenario.manager, booking.id);

    await expect(markNoShow(scenario.manager, booking.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
    // The exceptional cancel of a checked-in booking.
    expect(await cancelBooking(scenario.manager, booking.id)).toMatchObject({ status: "CANCELLED" });
    await expect(checkIn(scenario.manager, booking.id)).rejects.toMatchObject({ code: "INVALID_STATUS_TRANSITION" });
  });
});

describe("roles and trainer scope", () => {
  it("an accountant can view but not book (A-016)", async () => {
    const scenario = await bookingScenario();
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const booking = await book(scenario.manager, scenario);

    await expect(book(accountant, scenario)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelBooking(accountant, booking.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await getBooking(accountant, booking.id)).toMatchObject({ id: booking.id });
  });

  it("a trainer sees and books only for their own trainer record (A-007)", async () => {
    const scenario = await bookingScenario();
    const { actor: trainer, trainer: own } = await linkedTrainer(scenario.manager);
    const mine = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" }, own.id);
    const theirs = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });

    expect((await listBookings(trainer, {})).items.map((b) => b.id)).toEqual([mine.id]);
    expect((await listDayBookings(trainer, { date: "15/10/2026" })).map((b) => b.id)).toEqual([mine.id]);
    await expect(getBooking(trainer, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelBooking(trainer, theirs.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(book(trainer, scenario, { startTime: "12:00", endTime: "13:00" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(book(trainer, scenario, { startTime: "12:00", endTime: "13:00" }, own.id)).resolves.toBeDefined();
    await expect(
      rescheduleBooking(trainer, mine.id, {
        trainerId: scenario.trainer.id,
        date: "15/10/2026",
        startTime: "14:00",
        endTime: "15:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a trainer login without a trainer record cannot book (A-010)", async () => {
    const scenario = await bookingScenario();
    const { actor: trainer } = await createTestUser("PT");

    await expect(book(trainer, scenario)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listBookings(trainer, {})).total).toBe(0);
  });

  it("a trainer sees the customers and contracts they have bookings with, and no others (OQ-006 interim)", async () => {
    const scenario = await bookingScenario();
    const { actor: trainer, trainer: own } = await linkedTrainer(scenario.manager);
    const stranger = await createCustomer(scenario.manager, { fullName: "Lê Thị Hoa", phone: "0388777666" });
    await activeContract(scenario.manager, stranger.id);
    await book(scenario.manager, scenario, {}, own.id);

    expect((await listCustomers(trainer, {})).items.map((c) => c.id)).toEqual([scenario.customer.id]);
    expect((await listContracts(trainer, {})).items.map((c) => c.id)).toEqual([scenario.contract.id]);
    await expect(getCustomer(trainer, stranger.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listing", () => {
  it("filters by gym day: 23:30 belongs to its own day, 00:30 to the next (A-001)", async () => {
    const scenario = await bookingScenario();
    const late = await book(scenario.manager, scenario, { date: "15/10/2026", startTime: "23:00", endTime: "23:30" });
    const early = await book(scenario.manager, scenario, { date: "16/10/2026", startTime: "00:30", endTime: "01:00" });

    const on15 = await listBookings(scenario.manager, { from: "15/10/2026", to: "15/10/2026" });
    const on16 = await listDayBookings(scenario.manager, { date: "16/10/2026" });

    expect(on15.items.map((b) => b.id)).toEqual([late.id]);
    expect(on16.map((b) => b.id)).toEqual([early.id]);
  });

  it("filters by status, contract, and order", async () => {
    const scenario = await bookingScenario();
    const a = await book(scenario.manager, scenario, { startTime: "08:00", endTime: "09:00" });
    const b = await book(scenario.manager, scenario, { startTime: "10:00", endTime: "11:00" });
    await checkIn(scenario.manager, b.id);

    expect((await listBookings(scenario.manager, { status: "CHECKED_IN" })).items.map((x) => x.id)).toEqual([b.id]);
    expect(
      (await listBookings(scenario.manager, { contractId: scenario.contract.id, order: "desc" })).items.map(
        (x) => x.id,
      ),
    ).toEqual([b.id, a.id]);
    await expect(listBookings(scenario.manager, { status: "DONE" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
