import { z } from "zod";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { hasBranch, inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { parseInput } from "../../platform/validation/parse.js";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import { effectiveStatus, entitledSessions } from "@flow/shared/contracts";
import { isWithinContractPeriod } from "@flow/shared/bookings";
import {
  canMarkAttendance,
  canRemoveEnrollment,
  classInputSchema,
  classSessionsQuerySchema,
  classUpdateSchema,
  enrollSchema,
  hasSessionForEnrollment,
  isTaught,
  markAttendanceSchema,
  occurrenceDays,
  type ClassAttendee,
  type ClassSession,
  type GymClass,
} from "@flow/shared/classes";
import { findContract, lockContract, usedSessionsOf } from "../contracts/contract.repository.js";
import { holdCovering } from "../changes/voucher.repository.js";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import { findBookableTrainer } from "../employees/employee.service.js";
import { queueSessionEmail } from "../sessions/session-email.js";
import * as repo from "./class.repository.js";

// The class schedule (brief §6.4, D-031, BR-411; A-160 to A-164). Lock order: contract, then the class session (the
// seats), the same direction as a booking (T-013, T-036).

const DAY_MS = 24 * 60 * 60 * 1000;

function gymToday(): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE);
}

/** The gym day a class session falls on (A-001). */
function dayOf(startsAt: Date): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE, startsAt);
}

function toClassView(row: repo.ClassRecord): GymClass {
  return {
    id: row.id,
    name: row.name,
    branch: row.branch,
    coach: row.coach,
    capacity: row.capacity,
    weekdays: row.weekdays,
    startTime: row.startTime,
    endTime: row.endTime,
    active: row.active,
  };
}

function toAttendeeView(row: repo.ClassSessionRecord["attendances"][number]): ClassAttendee {
  const { contract } = row;
  return {
    id: row.id,
    customer: {
      id: row.customer.id,
      customerCode: row.customer.customerCode ?? "",
      fullName: row.customer.fullName,
    },
    contract: {
      id: contract.id,
      contractCode: contract.contractCode,
      packageName: contract.packageName,
      remainingSessions:
        entitledSessions(contract.totalSessions, contract.bonusSessions, contract.voucherSessions) -
        contract.openingSessionsUsed -
        usedSessionsOf(contract),
    },
    status: row.status as ClassAttendee["status"],
    consumes: row.consumes,
    enrolledAt: row.enrolledAt,
    markedAt: row.markedAt,
    markedBy: row.markedBy?.name ?? null,
  };
}

function toSessionView(row: repo.ClassSessionRecord, withAttendees: boolean): ClassSession {
  const statuses = row.attendances.map((attendance) => attendance.status);
  return {
    id: row.id,
    classId: row.classId,
    name: row.gymClass.name,
    branch: row.branch,
    coach: row.coach,
    capacity: row.capacity,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status as ClassSession["status"],
    seatsTaken: statuses.filter((status) => status !== "ABSENT").length,
    present: statuses.filter((status) => status === "PRESENT").length,
    taught: isTaught(statuses),
    ...(withAttendees ? { attendees: row.attendances.map(toAttendeeView) } : {}),
  };
}

// ---------------------------------------------------------------- classes

export async function listClasses(actor: Actor): Promise<GymClass[]> {
  assertCan(actor, "class.view");
  return (await repo.listClasses(prisma, inBranches(actor))).map(toClassView);
}

export async function createClass(actor: Actor, rawInput: unknown): Promise<GymClass> {
  assertCan(actor, "class.manage");
  const data = parseInput(classInputSchema, rawInput);
  if (!hasBranch(actor, data.branchId)) throw forbidden(actor, "class.manage", "branch outside the user's branches");
  await assertCoach(prisma, data.coachId, data.branchId);
  return prisma.$transaction(async (tx) => {
    const created = await repo.createClass(tx, data);
    await generateSessions(tx, [created]);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "class",
      entityId: created.id,
      action: "class.created",
      after: {
        name: created.name,
        branchId: created.branchId,
        coachId: created.coachId,
        capacity: created.capacity,
        weekdays: created.weekdays,
        startTime: created.startTime,
        endTime: created.endTime,
      },
    });
    return toClassView(created);
  });
}

/**
 * Name, coach, capacity and on/off (A-160). The days and the time are fixed: change them with a new class. A change
 * reaches the sessions still to come; switching a class off cancels the ones nobody is enrolled in.
 */
export async function updateClass(actor: Actor, id: string, rawInput: unknown): Promise<GymClass> {
  assertCan(actor, "class.manage");
  const data = parseInput(classUpdateSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const before = await repo.findClass(tx, id, inBranches(actor));
    if (!before) throw new AppError("NOT_FOUND");
    await assertCoach(tx, data.coachId, before.branchId);
    const now = new Date();
    if (data.capacity < (await repo.maxFutureSeats(tx, id, now))) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { capacity: ["belowEnrolled"] } });
    }
    const after = await repo.updateClass(tx, id, data);
    if (before.active && !data.active) await repo.cancelEmptyFutureSessions(tx, id, now);
    if (data.active) {
      if (!before.active) await repo.reviveFutureSessions(tx, id, now);
      await repo.updateFutureSessions(tx, id, now, { coachId: data.coachId, capacity: data.capacity });
      await generateSessions(tx, [after]);
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "class",
      entityId: id,
      action: "class.updated",
      before: { name: before.name, coachId: before.coachId, capacity: before.capacity, active: before.active },
      after: { name: after.name, coachId: after.coachId, capacity: after.capacity, active: after.active },
    });
    return toClassView(after);
  });
}

async function assertCoach(db: Db, coachId: string, branchId: string): Promise<void> {
  const coach = await findBookableTrainer(db, coachId);
  if (!coach || coach.branchId !== branchId) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { coachId: ["trainerUnavailable"] } });
  }
}

// ------------------------------------------------------- generating sessions

type Generated = Pick<
  repo.ClassRecord,
  "id" | "branchId" | "coachId" | "capacity" | "weekdays" | "startTime" | "endTime"
>;

/**
 * Makes the sessions of the given classes for the next `classGenerateWeeks` weeks (A-161), once each: a rerun adds only
 * the days not made yet. Returns how many were added.
 */
export async function generateSessions(db: Db, classes: Generated[], from: Date = gymToday()): Promise<number> {
  const weeks = Number(await readParameter(db, "classGenerateWeeks"));
  const rows = classes.flatMap((gymClass) =>
    occurrenceDays(gymClass.weekdays, from, weeks * 7).map((day) => ({
      classId: gymClass.id,
      branchId: gymClass.branchId,
      coachId: gymClass.coachId,
      capacity: gymClass.capacity,
      startsAt: instantAt(day, gymClass.startTime, env.GYM_TIMEZONE),
      endsAt: instantAt(day, gymClass.endTime, env.GYM_TIMEZONE),
    })),
  );
  return repo.insertSessions(db, rows);
}

/** The worker's hourly job: keeps every active class generated ahead. */
export async function generateAllSessions(): Promise<number> {
  return generateSessions(prisma, await repo.activeClasses(prisma));
}

// ------------------------------------------------------------- the grid

export async function listClassSessions(actor: Actor, rawQuery: unknown): Promise<ClassSession[]> {
  assertCan(actor, "class.view");
  const { date, days, branchId, coachId, classId } = parseInput(classSessionsQuerySchema, rawQuery);
  const start = instantAt(date, "00:00", env.GYM_TIMEZONE);
  const end = instantAt(new Date(date.getTime() + days * DAY_MS), "00:00", env.GYM_TIMEZONE);
  const rows = await repo.listSessions(prisma, {
    AND: [inBranches(actor), { branchId, coachId, classId, startsAt: { gte: start, lt: end } }],
  });
  return rows.map((row) => toSessionView(row, false));
}

export async function getClassSession(actor: Actor, id: string): Promise<ClassSession> {
  assertCan(actor, "class.view");
  const row = await visibleSession(prisma, actor, id);
  return toSessionView(row, true);
}

async function visibleSession(db: Db, actor: Actor, id: string): Promise<repo.ClassSessionRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const row = await repo.findSession(db, id, inBranches(actor));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

// ------------------------------------------------------------ enrollment

/**
 * Enrolls a customer on their group-class contract (BR-411, A-162). Refused when the class session is cancelled or
 * full, the customer already has a seat, or the contract is not a class contract of this branch, is not active, does
 * not cover the day, or has no session left beyond those already promised to other enrollments. Enrolling consumes
 * nothing; being marked present does (A-163).
 */
export async function enrollCustomer(actor: Actor, sessionId: string, rawInput: unknown): Promise<ClassSession> {
  assertCan(actor, "class.enroll");
  const { customerId, contractId } = parseInput(enrollSchema, rawInput);
  if (!z.uuid().safeParse(sessionId).success) throw new AppError("NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    if (!(await lockContract(tx, contractId))) throw new AppError("NOT_FOUND");
    if (!(await repo.lockSession(tx, sessionId))) throw new AppError("NOT_FOUND");
    const session = await visibleSession(tx, actor, sessionId);
    if (session.status !== "SCHEDULED") throw new AppError("CLASS_SESSION_CANCELLED");
    if (isOwnOnly(actor, "schedule") && actor.employeeId !== session.coachId) {
      throw forbidden(actor, "class.enroll", "enrollment in another coach's class");
    }
    const contract = await findContract(tx, contractId, contractsVisibleTo(actor));
    if (!contract) throw new AppError("NOT_FOUND");
    if (contract.customerId !== customerId) throw new AppError("BOOKING_CUSTOMER_CONTRACT_MISMATCH");
    if (contract.service?.kind !== "CLASS" || contract.branch.id !== session.branch.id) {
      throw new AppError("CLASS_CONTRACT_MISMATCH");
    }
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if (effectiveStatus(contract, gymToday()) !== "ACTIVE") throw new AppError("CONTRACT_NOT_ACTIVE");
    if (!isWithinContractPeriod(dayOf(session.startsAt), contract))
      throw new AppError("BOOKING_OUTSIDE_CONTRACT_PERIOD");
    // A day inside an approved hold is not enrolled (M8.1, A-222).
    if (await holdCovering(tx, contract.id, dayOf(session.startsAt))) throw new AppError("CONTRACT_ON_HOLD");
    if (session.attendances.some((attendance) => attendance.customer.id === customerId)) {
      throw new AppError("CLASS_ALREADY_ENROLLED");
    }
    if ((await repo.countSeats(tx, sessionId)) >= session.capacity) throw new AppError("CLASS_FULL");
    const remaining =
      entitledSessions(contract.totalSessions, contract.bonusSessions, contract.voucherSessions) -
      contract.openingSessionsUsed -
      usedSessionsOf(contract);
    if (!hasSessionForEnrollment(remaining, await repo.countOpenEnrollments(tx, contractId))) {
      throw new AppError("CONTRACT_NO_REMAINING_SESSIONS");
    }

    const attendance = await repo.insertAttendance(tx, {
      classSessionId: sessionId,
      customerId,
      contractId,
      enrolledById: actor.id,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "class_session",
      entityId: sessionId,
      action: "class.enrolled",
      after: { attendanceId: attendance.id, customerId, contractId },
    });
    return toSessionView((await repo.findSession(tx, sessionId))!, true);
  }, LOCKING_TRANSACTION);
}

/** Takes a customer off a class session before attendance is marked; the seat is free again (A-162). */
export async function removeEnrollment(actor: Actor, sessionId: string, attendanceId: string): Promise<ClassSession> {
  assertCan(actor, "class.enroll");
  if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(attendanceId).success)
    throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const owners = await repo.attendanceOwners(tx, attendanceId);
    if (!owners || owners.sessionId !== sessionId) throw new AppError("NOT_FOUND");
    await lockContract(tx, owners.contractId);
    await repo.lockSession(tx, sessionId);
    const session = await visibleSession(tx, actor, sessionId);
    if (isOwnOnly(actor, "schedule") && actor.employeeId !== session.coachId) {
      throw forbidden(actor, "class.enroll", "removal from another coach's class");
    }
    const attendance = await repo.findAttendance(tx, attendanceId, sessionId);
    if (!attendance) throw new AppError("NOT_FOUND");
    if (!canRemoveEnrollment(attendance.status)) throw new AppError("INVALID_STATUS_TRANSITION");
    await repo.deleteAttendance(tx, attendanceId);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "class_session",
      entityId: sessionId,
      action: "class.enrollment_removed",
      before: { attendanceId, customerId: attendance.customerId, contractId: attendance.contractId },
    });
    return toSessionView((await repo.findSession(tx, sessionId))!, true);
  }, LOCKING_TRANSACTION);
}

// ------------------------------------------------------------ attendance

/**
 * Marks an enrolled customer present or absent (brief §6.4, A-163). Present takes one session off the customer's
 * group-class contract and counts the class as taught for the coach (A-164); absent takes none. A mark is final, and
 * repeating the same mark changes nothing. Only the coach of the class marks it (a coach login sees its own classes),
 * and not before the class has started.
 */
export async function markAttendance(
  actor: Actor,
  sessionId: string,
  attendanceId: string,
  rawInput: unknown,
): Promise<ClassSession> {
  assertCan(actor, "class.attend");
  const { status } = parseInput(markAttendanceSchema, rawInput);
  if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(attendanceId).success)
    throw new AppError("NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    const owners = await repo.attendanceOwners(tx, attendanceId);
    if (!owners || owners.sessionId !== sessionId) throw new AppError("NOT_FOUND");
    if (!(await lockContract(tx, owners.contractId))) throw new AppError("NOT_FOUND");
    await repo.lockSession(tx, sessionId);
    const session = await visibleSession(tx, actor, sessionId);
    if (isOwnOnly(actor, "schedule") && actor.employeeId !== session.coachId) {
      throw forbidden(actor, "class.attend", "attendance of another coach's class");
    }
    const attendance = await repo.findAttendance(tx, attendanceId, sessionId);
    if (!attendance) throw new AppError("NOT_FOUND");
    // Repeating the mark that is already there returns the class as it is, consuming nothing more.
    if (attendance.status === status) return toSessionView((await repo.findSession(tx, sessionId))!, true);
    if (!canMarkAttendance(attendance.status)) throw new AppError("INVALID_STATUS_TRANSITION");
    if (session.status !== "SCHEDULED") throw new AppError("CLASS_SESSION_CANCELLED");
    if (session.startsAt.getTime() > Date.now()) throw new AppError("CLASS_NOT_STARTED");

    let remaining: number | null = null;
    if (status === "PRESENT") {
      const contract = await findContract(tx, attendance.contractId, {});
      if (!contract) throw new AppError("NOT_FOUND");
      if (contract.status === "CANCELLED") throw new AppError("CONTRACT_NOT_ACTIVE");
      if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
      if (!isWithinContractPeriod(dayOf(session.startsAt), contract))
        throw new AppError("BOOKING_OUTSIDE_CONTRACT_PERIOD");
      if (await holdCovering(tx, contract.id, dayOf(session.startsAt))) throw new AppError("CONTRACT_ON_HOLD");
      remaining =
        entitledSessions(contract.totalSessions, contract.bonusSessions, contract.voucherSessions) -
        contract.openingSessionsUsed -
        usedSessionsOf(contract);
      if (remaining <= 0) throw new AppError("CONTRACT_NO_REMAINING_SESSIONS");
    }
    const changed = await repo.markAttendance(tx, attendanceId, "ENROLLED", {
      status,
      markedById: actor.id,
      markedAt: new Date(),
    });
    if (changed !== 1) throw new AppError("INVALID_STATUS_TRANSITION");
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "class_session",
      entityId: sessionId,
      action: status === "PRESENT" ? "class.attended" : "class.absent",
      before: { status: "ENROLLED" },
      after: { status, consumes: status === "PRESENT" },
      context: {
        attendanceId,
        customerId: attendance.customerId,
        contractId: attendance.contractId,
        remainingSessions: remaining === null ? null : remaining - 1,
      },
    });
    if (status === "PRESENT") {
      // D-036: a class session that uses a session tells the customer, once.
      const held = await tx.classSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { startsAt: true, gymClass: { select: { name: true } }, coach: { select: { fullName: true } } },
      });
      await queueSessionEmail(tx, {
        event: "class.attended",
        causeId: attendanceId,
        customerId: attendance.customerId,
        contractId: attendance.contractId,
        start: held.startsAt,
        trainerName: held.coach.fullName,
        className: held.gymClass.name,
        by: actor.id,
      });
    }
    return toSessionView((await repo.findSession(tx, sessionId))!, true);
  }, LOCKING_TRANSACTION);
}
