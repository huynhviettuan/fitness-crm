import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { getContract } from "../../src/modules/contracts/contract.service.js";
import {
  enrollCustomer,
  generateAllSessions,
  getClassSession,
  listClassSessions,
  markAttendance,
  removeEnrollment,
  updateClass,
} from "../../src/modules/classes/class.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, DEFAULT_BRANCH_ID } from "../support/factories.js";
import { activeContract, createTrainer, linkedTrainer } from "../support/bookings.js";
import { classCustomer, everyDayClass, gymTodayText } from "../support/classes.js";

afterEach(async () => {
  await resetDatabase();
});

// The class schedule (M5.5; brief §6.4; D-031, BR-411; docs/13 E2E-110).

async function setup(options: { capacity?: number } = {}) {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  const { gymClass, coach } = await everyDayClass(admin, manager, options);
  const today = (await listClassSessions(admin, { date: gymTodayText(), days: 1 }))[0]!;
  const tomorrow = (await listClassSessions(admin, { date: gymTodayText(1), days: 1 }))[0]!;
  return { admin, manager, reception, gymClass, coach, today, tomorrow };
}

/** A gym day as the calendar date the database holds. */
const gymDate = (offsetDays: number) =>
  new Date(`${gymTodayText(offsetDays).split("/").reverse().join("-")}T00:00:00Z`);

const remaining = async (scenario: { manager: Parameters<typeof getContract>[0] }, contractId: string) =>
  (await getContract(scenario.manager, contractId)).remainingSessions;

describe("classes and their sessions (A-160, A-161)", () => {
  it("makes the sessions of the next eight weeks, once each", async () => {
    const { admin, gymClass } = await setup();
    expect(await prisma.classSession.count({ where: { classId: gymClass.id } })).toBe(56);

    await generateAllSessions();
    await generateAllSessions();

    expect(await prisma.classSession.count({ where: { classId: gymClass.id } })).toBe(56);
    const week = await listClassSessions(admin, { date: gymTodayText(), days: 7 });
    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ name: "Group Training 00:01", capacity: 20, seatsTaken: 0, taught: false });
  });

  it("runs only on its weekdays", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const coach = await createTrainer(admin, { fullName: "HLV Thứ Hai" });
    const { createClass } = await import("../../src/modules/classes/class.service.js");
    await createClass(admin, {
      name: "Monday only",
      branchId: DEFAULT_BRANCH_ID,
      coachId: coach.id,
      capacity: 5,
      weekdays: ["1"],
      startTime: "12:15",
      endTime: "13:15",
    });
    const rows = await prisma.classSession.findMany({ select: { startsAt: true } });
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeLessThanOrEqual(9);
    for (const row of rows) {
      // 12:15 in the gym (UTC+7) is 05:15Z; every session is on a Monday.
      expect(row.startsAt.getUTCHours()).toBe(5);
      expect(row.startsAt.getUTCDay()).toBe(1);
    }
  });

  it("is managed by Admin and Fitness Manager only, and the coach must teach in the class's branch", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const coach = await createTrainer(admin, { fullName: "HLV" });
    const { createClass } = await import("../../src/modules/classes/class.service.js");
    const input = {
      name: "Lớp",
      branchId: DEFAULT_BRANCH_ID,
      coachId: coach.id,
      capacity: 5,
      weekdays: [1],
      startTime: "12:15",
      endTime: "13:15",
    };
    for (const role of ["RECEPTIONIST", "PT", "ACCOUNTANT"] as const) {
      const { actor } = await createTestUser(role, { allBranches: true });
      await expect(createClass(actor, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(createClass(admin, { ...input, coachId: crypto.randomUUID() })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { coachId: ["trainerUnavailable"] },
    });
    await expect(createClass(admin, { ...input, endTime: "12:00" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { endTime: ["endTimeNotAfterStart"] },
    });
    await expect(createClass(admin, { ...input, weekdays: [] })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(createClass(admin, { ...input, name: "a\u0007b" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("enrollment (BR-411, A-162)", () => {
  it("enrolls a customer on their class contract and takes a seat, using nothing yet", async () => {
    const scenario = await setup();
    const { customer, contract } = await classCustomer(scenario.manager);

    const session = await enrollCustomer(scenario.reception, scenario.tomorrow.id, {
      customerId: customer.id,
      contractId: contract.id,
    });

    expect(session).toMatchObject({ seatsTaken: 1, present: 0, taught: false });
    expect(session.attendees).toMatchObject([
      { status: "ENROLLED", consumes: false, customer: { id: customer.id }, contract: { id: contract.id } },
    ]);
    expect(await remaining(scenario, contract.id)).toBe(12);
  });

  it("refuses a full class, a second seat, another customer's contract, and a contract that is not a class contract", async () => {
    const scenario = await setup({ capacity: 1 });
    const first = await classCustomer(scenario.manager, { fullName: "Khách Một" });
    const second = await classCustomer(scenario.manager, { fullName: "Khách Hai" });
    const pt = await activeContract(scenario.manager, first.customer.id, { sessions: 12 });
    const book = (who: typeof first, contractId = who.contract.id) =>
      enrollCustomer(scenario.reception, scenario.tomorrow.id, { customerId: who.customer.id, contractId });

    await expect(book(first, pt.id)).rejects.toMatchObject({ code: "CLASS_CONTRACT_MISMATCH" });
    await expect(book(first, second.contract.id)).rejects.toMatchObject({ code: "BOOKING_CUSTOMER_CONTRACT_MISMATCH" });
    await book(first);
    await expect(book(first)).rejects.toMatchObject({ code: "CLASS_ALREADY_ENROLLED" });
    await expect(book(second)).rejects.toMatchObject({ code: "CLASS_FULL" });
  });

  it("gives the last seat to one of many requests sent at once", async () => {
    const scenario = await setup({ capacity: 1 });
    const people = [];
    for (let index = 0; index < 5; index += 1) {
      people.push(await classCustomer(scenario.manager, { fullName: `Khách ${index}` }));
    }

    const results = await Promise.allSettled(
      people.map((who) =>
        enrollCustomer(scenario.reception, scenario.tomorrow.id, {
          customerId: who.customer.id,
          contractId: who.contract.id,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "CLASS_FULL" });
    }
    expect(await prisma.classAttendance.count()).toBe(1);
  });

  it("does not promise more sessions than the contract has left", async () => {
    const scenario = await setup();
    const { customer, contract } = await classCustomer(scenario.manager, { sessions: 1 });
    await enrollCustomer(scenario.reception, scenario.tomorrow.id, {
      customerId: customer.id,
      contractId: contract.id,
    });

    const later = (await listClassSessions(scenario.admin, { date: gymTodayText(2), days: 1 }))[0]!;
    await expect(
      enrollCustomer(scenario.reception, later.id, { customerId: customer.id, contractId: contract.id }),
    ).rejects.toMatchObject({ code: "CONTRACT_NO_REMAINING_SESSIONS" });
  });

  it("refuses a day outside the contract, a deactivated contract, and a cancelled class session", async () => {
    const scenario = await setup();
    const { customer, contract } = await classCustomer(scenario.manager);
    await prisma.contract.update({ where: { id: contract.id }, data: { endDate: gymDate(-1) } });
    await expect(
      enrollCustomer(scenario.reception, scenario.tomorrow.id, { customerId: customer.id, contractId: contract.id }),
    ).rejects.toMatchObject({ code: "CONTRACT_NOT_ACTIVE" });
    // Ending today, the contract is still active but does not cover tomorrow's class.
    await prisma.contract.update({ where: { id: contract.id }, data: { endDate: gymDate(0) } });
    await expect(
      enrollCustomer(scenario.reception, scenario.tomorrow.id, { customerId: customer.id, contractId: contract.id }),
    ).rejects.toMatchObject({ code: "BOOKING_OUTSIDE_CONTRACT_PERIOD" });
    await prisma.contract.update({ where: { id: contract.id }, data: { endDate: new Date("2031-01-01T00:00:00Z") } });
    await prisma.classSession.update({ where: { id: scenario.tomorrow.id }, data: { status: "CANCELLED" } });
    await expect(
      enrollCustomer(scenario.reception, scenario.tomorrow.id, { customerId: customer.id, contractId: contract.id }),
    ).rejects.toMatchObject({ code: "CLASS_SESSION_CANCELLED" });
  });

  it("is for reception, coaches, managers and Admin; the accountant cannot", async () => {
    const scenario = await setup();
    const { customer, contract } = await classCustomer(scenario.manager);
    const { actor: accountant } = await createTestUser("ACCOUNTANT", { allBranches: true });
    await expect(
      enrollCustomer(accountant, scenario.tomorrow.id, { customerId: customer.id, contractId: contract.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      enrollCustomer(scenario.reception, "not-a-uuid", { customerId: customer.id, contractId: contract.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes a customer off before attendance is marked, and the seat is free again", async () => {
    const scenario = await setup({ capacity: 1 });
    const first = await classCustomer(scenario.manager, { fullName: "Khách Một" });
    const second = await classCustomer(scenario.manager, { fullName: "Khách Hai" });
    const seated = await enrollCustomer(scenario.reception, scenario.tomorrow.id, {
      customerId: first.customer.id,
      contractId: first.contract.id,
    });

    const freed = await removeEnrollment(scenario.reception, scenario.tomorrow.id, seated.attendees![0]!.id);
    expect(freed.seatsTaken).toBe(0);
    await expect(
      enrollCustomer(scenario.reception, scenario.tomorrow.id, {
        customerId: second.customer.id,
        contractId: second.contract.id,
      }),
    ).resolves.toMatchObject({ seatsTaken: 1 });
  });
});

describe("attendance (A-163, A-164)", () => {
  async function enrolledToday(options: { sessions?: number; capacity?: number } = {}) {
    const scenario = await setup(options);
    const who = await classCustomer(scenario.manager, { sessions: options.sessions });
    const session = await enrollCustomer(scenario.reception, scenario.today.id, {
      customerId: who.customer.id,
      contractId: who.contract.id,
    });
    return { ...scenario, ...who, attendeeId: session.attendees![0]!.id };
  }

  it("takes one session off the contract when present, and counts the class as taught", async () => {
    const scenario = await enrolledToday();
    const { admin, today, attendeeId, contract } = scenario;

    const marked = await markAttendance(admin, today.id, attendeeId, { status: "PRESENT" });

    expect(marked).toMatchObject({ present: 1, taught: true, seatsTaken: 1 });
    expect(marked.attendees![0]).toMatchObject({ status: "PRESENT", consumes: true, markedBy: admin.name });
    expect(await remaining(scenario, contract.id)).toBe(11);
    expect(await prisma.auditEvent.count({ where: { entityId: today.id, action: "class.attended" } })).toBe(1);
  });

  it("takes nothing when absent, frees the seat, and does not count the class as taught", async () => {
    const scenario = await enrolledToday();
    const marked = await markAttendance(scenario.admin, scenario.today.id, scenario.attendeeId, { status: "ABSENT" });

    expect(marked).toMatchObject({ present: 0, taught: false, seatsTaken: 0 });
    expect(await remaining(scenario, scenario.contract.id)).toBe(12);
  });

  it("consumes once when repeated or sent many times at once", async () => {
    const scenario = await enrolledToday();
    const { admin, today, attendeeId } = scenario;

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => markAttendance(admin, today.id, attendeeId, { status: "PRESENT" })),
    );

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await remaining(scenario, scenario.contract.id)).toBe(11);
    expect(await prisma.auditEvent.count({ where: { entityId: today.id, action: "class.attended" } })).toBe(1);
  });

  it("is final: a mark does not change to the other, and a removed seat cannot be marked", async () => {
    const scenario = await enrolledToday();
    const { admin, today, attendeeId } = scenario;
    await markAttendance(admin, today.id, attendeeId, { status: "PRESENT" });

    await expect(markAttendance(admin, today.id, attendeeId, { status: "ABSENT" })).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
    await expect(removeEnrollment(admin, today.id, attendeeId)).rejects.toMatchObject({
      code: "INVALID_STATUS_TRANSITION",
    });
    expect(await remaining(scenario, scenario.contract.id)).toBe(11);
  });

  it("waits for the class to start", async () => {
    const scenario = await setup();
    const who = await classCustomer(scenario.manager);
    const seated = await enrollCustomer(scenario.reception, scenario.tomorrow.id, {
      customerId: who.customer.id,
      contractId: who.contract.id,
    });
    await expect(
      markAttendance(scenario.admin, scenario.tomorrow.id, seated.attendees![0]!.id, { status: "PRESENT" }),
    ).rejects.toMatchObject({ code: "CLASS_NOT_STARTED" });
  });

  it("needs a session left, and an active contract", async () => {
    const scenario = await enrolledToday({ sessions: 1 });
    await prisma.contract.update({ where: { id: scenario.contract.id }, data: { status: "FROZEN" } });
    await expect(
      markAttendance(scenario.admin, scenario.today.id, scenario.attendeeId, { status: "PRESENT" }),
    ).rejects.toMatchObject({ code: "CONTRACT_FROZEN" });
    await prisma.contract.update({ where: { id: scenario.contract.id }, data: { status: "ACTIVE" } });
    await prisma.contract.update({ where: { id: scenario.contract.id }, data: { openingSessionsUsed: 1 } });
    await expect(
      markAttendance(scenario.admin, scenario.today.id, scenario.attendeeId, { status: "PRESENT" }),
    ).rejects.toMatchObject({ code: "CONTRACT_NO_REMAINING_SESSIONS" });
  });

  it("is marked by the class's own coach, not by another coach", async () => {
    const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
    const { actor: manager } = await createTestUser("FITNESS_MANAGER", { allBranches: true });
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const { user } = await createTestUser("PT");
    const own = await createTrainer(manager, { fullName: "HLV Của Lớp", userId: user.id });
    const { createClass } = await import("../../src/modules/classes/class.service.js");
    await createClass(admin, {
      name: "Lớp của tôi",
      branchId: DEFAULT_BRANCH_ID,
      coachId: own.id,
      capacity: 5,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startTime: "00:01",
      endTime: "00:59",
    });
    const today = (await listClassSessions(admin, { date: gymTodayText(), days: 1 }))[0]!;
    const who = await classCustomer(manager);
    const seated = await enrollCustomer(reception, today.id, {
      customerId: who.customer.id,
      contractId: who.contract.id,
    });
    const attendeeId = seated.attendees![0]!.id;

    const other = await linkedTrainer(manager, "HLV Khác");
    await expect(markAttendance(other.actor, today.id, attendeeId, { status: "PRESENT" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { actorOf } = await import("../support/factories.js");
    await expect(
      markAttendance(await actorOf(user.id), today.id, attendeeId, { status: "PRESENT" }),
    ).resolves.toMatchObject({ present: 1 });
    expect(await getClassSession(admin, today.id)).toMatchObject({ taught: true });
  });

  it("shows up in the contract's sessions used and blocks deleting the contract", async () => {
    const scenario = await enrolledToday();
    await markAttendance(scenario.admin, scenario.today.id, scenario.attendeeId, { status: "PRESENT" });
    const view = await getContract(scenario.manager, scenario.contract.id);
    expect(view).toMatchObject({ completedSessions: 1, remainingSessions: 11 });
  });
});

describe("changing a class (A-160)", () => {
  it("cannot go below the seats already given, and passes the coach and capacity on to the sessions to come", async () => {
    const scenario = await setup({ capacity: 3 });
    const who = await classCustomer(scenario.manager);
    await enrollCustomer(scenario.reception, scenario.tomorrow.id, {
      customerId: who.customer.id,
      contractId: who.contract.id,
    });
    const other = await createTrainer(scenario.manager, { fullName: "HLV Mới" });
    const input = { name: "Đổi tên", coachId: other.id, capacity: 3, active: true };

    await expect(updateClass(scenario.admin, scenario.gymClass.id, { ...input, capacity: 0 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await updateClass(scenario.admin, scenario.gymClass.id, { ...input, capacity: 1 });
    const after = await getClassSession(scenario.admin, scenario.tomorrow.id);
    expect(after).toMatchObject({ capacity: 1, coach: { id: other.id } });
  });

  it("switched off, it cancels the sessions nobody is enrolled in and keeps the ones with seats", async () => {
    const scenario = await setup();
    const who = await classCustomer(scenario.manager);
    await enrollCustomer(scenario.reception, scenario.tomorrow.id, {
      customerId: who.customer.id,
      contractId: who.contract.id,
    });

    await updateClass(scenario.admin, scenario.gymClass.id, {
      name: scenario.gymClass.name,
      coachId: scenario.coach.id,
      capacity: 20,
      active: false,
    });
    const rows = await prisma.classSession.findMany({
      where: { classId: scenario.gymClass.id, startsAt: { gt: new Date() } },
    });
    expect(rows.filter((row) => row.status === "SCHEDULED").map((row) => row.id)).toEqual([scenario.tomorrow.id]);

    // Switched on again, the sessions come back.
    await updateClass(scenario.admin, scenario.gymClass.id, {
      name: scenario.gymClass.name,
      coachId: scenario.coach.id,
      capacity: 20,
      active: true,
    });
    expect(
      await prisma.classSession.count({
        where: { classId: scenario.gymClass.id, startsAt: { gt: new Date() }, status: "CANCELLED" },
      }),
    ).toBe(0);
  });
});
