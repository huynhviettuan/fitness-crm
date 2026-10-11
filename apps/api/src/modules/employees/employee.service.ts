import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isExclusionViolation, isUniqueViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import * as repo from "./employee.repository.js";
import {
  coversSlot,
  dayOffInputSchema,
  employeeInputSchema,
  isoWeekday,
  listEmployeesSchema,
  minutesOfTime,
  shiftsInputSchema,
  timeOfMinutes,
  trainersOfDaySchema,
  workingIntervals,
  type DayOff,
  type Employee as EmployeeView,
  type EmployeeData,
  type EmployeeLogin,
  type EmployeePage,
  type TrainerDay,
  type WorkSchedule,
} from "@flow/shared/employees";

const AUDITED_FIELDS = [
  "fullName",
  "birthDate",
  "gender",
  "phone",
  "email",
  "departmentId",
  "departmentNote",
  "team",
  "titleId",
  "titleNote",
  "status",
  "isTrainer",
  "userId",
  "branchId",
] as const;

/**
 * Which employees an actor may see: their branches, and with "own" staff scope only
 * themselves (D-017; the PT sees their own profile and schedule, 09_RBAC.md).
 */
export function employeesVisibleTo(actor: Actor): Prisma.EmployeeWhereInput {
  return { AND: [inBranches(actor), isOwnOnly(actor, "staff") ? { userId: actor.id } : {}] };
}

export async function listEmployees(actor: Actor, rawQuery: unknown = {}): Promise<EmployeePage> {
  assertCan(actor, "employee.view");
  const query = parseInput(listEmployeesSchema, rawQuery);
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      employeesVisibleTo(actor),
      repo.searchWhere(query.q),
      { status: query.status, departmentId: query.departmentId },
      query.trainersOnly ? { isTrainer: true } : {},
    ],
  };
  const { items, total } = await repo.listEmployees(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: items.map(toView), total, page: query.page, pageSize: query.pageSize };
}

export async function getEmployee(actor: Actor, id: string): Promise<EmployeeView> {
  assertCan(actor, "employee.view");
  return toView(await visibleEmployee(prisma, actor, id));
}

export async function createEmployee(actor: Actor, input: unknown): Promise<EmployeeView> {
  assertCan(actor, "employee.manage");
  const data = parseInput(employeeInputSchema, input);

  return withLinkConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const branchId = await resolveBranch(tx, actor, data.branchId);
      const write = await toWrite(tx, data, branchId, null);
      const employee = await repo.createEmployee(tx, await repo.nextEmployeeCode(tx), write);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "employee",
        entityId: employee.id,
        action: "employee.created",
        after: { employeeCode: employee.employeeCode, ...pick(employee, AUDITED_FIELDS) },
      });
      return toView(employee);
    }),
  );
}

/** All fields are sent; a left-out branch keeps the employee where they are. */
export async function updateEmployee(actor: Actor, id: string, input: unknown): Promise<EmployeeView> {
  assertCan(actor, "employee.manage");
  const data = parseInput(employeeInputSchema, input);

  return withLinkConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = await visibleEmployee(tx, actor, id);
      const branchId = data.branchId ? await resolveBranch(tx, actor, data.branchId) : before.branchId;
      const after = await repo.updateEmployee(tx, id, await toWrite(tx, data, branchId, before));
      const changes = diffFields(before, after, AUDITED_FIELDS);
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "employee",
          entityId: id,
          action: "employee.updated",
          ...changes,
        });
      }
      return toView(after);
    }),
  );
}

/** Logins to link to an employee, and the employee each already belongs to (brief §8.4). */
export async function listEmployeeLogins(actor: Actor): Promise<EmployeeLogin[]> {
  assertCan(actor, "employee.manage");
  const users = await repo.listLogins(prisma);
  return users.map(({ id, name, email, employee }) => ({ id, name, email, linkedEmployeeId: employee?.id ?? null }));
}

// ---------------------------------------------------------------- working schedule

/** The weekly shifts and the days off from today on (brief §8.4). */
export async function getWorkSchedule(actor: Actor, id: string): Promise<WorkSchedule> {
  assertCan(actor, "employee.view");
  await visibleEmployee(prisma, actor, id);
  return workSchedule(prisma, id);
}

/** Replaces the weekly pattern. Bookings already made stay as they are (A-042). */
export async function replaceShifts(actor: Actor, id: string, input: unknown): Promise<WorkSchedule> {
  assertCan(actor, "employee.manage");
  const { shifts } = parseInput(shiftsInputSchema, input);
  const rows = shifts
    .map((shift) => ({
      weekday: shift.weekday,
      startMinute: minutesOfTime(shift.start),
      endMinute: minutesOfTime(shift.end),
    }))
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);

  return withShiftOverlapMapped(() =>
    prisma.$transaction(async (tx) => {
      await visibleEmployee(tx, actor, id);
      if (!(await repo.lockEmployee(tx, id))) throw new AppError("NOT_FOUND");
      const before = await repo.findShifts(tx, id);
      await repo.replaceShifts(tx, id, rows);
      const changes = diffFields({ shifts: describeShifts(before) }, { shifts: describeShifts(rows) }, ["shifts"]);
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "employee",
          entityId: id,
          action: "employee.shifts_changed",
          ...changes,
        });
      }
      return workSchedule(tx, id);
    }, LOCKING_TRANSACTION),
  );
}

export async function addDayOff(actor: Actor, id: string, input: unknown): Promise<DayOff> {
  assertCan(actor, "employee.manage");
  const data = parseInput(dayOffInputSchema, input);
  try {
    return await prisma.$transaction(async (tx) => {
      await visibleEmployee(tx, actor, id);
      const dayOff = await repo.createDayOff(tx, id, data);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "employee",
        entityId: id,
        action: "employee.day_off_added",
        after: { date: dayOff.date, note: dayOff.note },
      });
      return dayOff;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("VALIDATION_FAILED", { fieldErrors: { date: ["dayOffExists"] } });
    throw error;
  }
}

/** Working again on that day. The entry is schedule data, not a business record: it is audited, not trashed. */
export async function removeDayOff(actor: Actor, id: string, dayOffId: string): Promise<void> {
  assertCan(actor, "employee.manage");
  if (!z.uuid().safeParse(dayOffId).success) throw new AppError("NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await visibleEmployee(tx, actor, id);
    const dayOff = await repo.findDayOff(tx, id, dayOffId);
    if (!dayOff) throw new AppError("NOT_FOUND");
    await repo.deleteDayOff(tx, dayOff.id);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "employee",
      entityId: id,
      action: "employee.day_off_removed",
      before: { date: dayOff.date, note: dayOff.note },
    });
  });
}

/**
 * The PT calendar's rows for one day (D-030): active trainers of the actor's branches,
 * or only themselves with "own" schedule scope, with their working hours that day.
 */
export async function trainersOfDay(actor: Actor, rawQuery: unknown): Promise<TrainerDay[]> {
  assertCan(actor, "booking.view");
  const { date } = parseInput(trainersOfDaySchema, rawQuery);
  if (isOwnOnly(actor, "schedule") && !actor.employeeId) return [];
  const where: Prisma.EmployeeWhereInput = {
    AND: [inBranches(actor), isOwnOnly(actor, "schedule") ? { id: actor.employeeId ?? undefined } : {}],
  };
  const trainers = await repo.trainersWithDay(prisma, where, isoWeekday(date), date);
  return trainers.map(({ shifts, daysOff, ...trainer }) => {
    const dayOff = daysOff.length > 0;
    return {
      trainer,
      dayOff,
      workingHours: workingIntervals(shifts.map(toShift), isoWeekday(date), dayOff).map((interval) => ({
        start: timeOfMinutes(interval.start),
        end: timeOfMinutes(interval.end),
      })),
    };
  });
}

/**
 * D-030: a booking lies inside the trainer's working hours of its gym day, and that day
 * is not one of their days off. Read inside the booking's transaction.
 */
export async function assertWithinWorkingHours(db: Db, employeeId: string, start: Date, end: Date): Promise<void> {
  const day = calendarDateInTimeZone(env.GYM_TIMEZONE, start);
  const midnight = instantAt(day, "00:00", env.GYM_TIMEZONE).getTime();
  const from = (start.getTime() - midnight) / 60_000;
  const to = (end.getTime() - midnight) / 60_000;
  const outside =
    (await repo.isDayOff(db, employeeId, day)) ||
    !coversSlot(workingIntervals((await repo.findShifts(db, employeeId)).map(toShift), isoWeekday(day)), from, to);
  if (outside) throw new AppError("BOOKING_OUTSIDE_WORKING_HOURS");
}

/** A trainer who can take a booking: teaches PT and still works here. */
export async function findBookableTrainer(db: Db, id: string) {
  const employee = await repo.findEmployee(db, id);
  return employee?.isTrainer && employee.status === "ACTIVE" ? employee : null;
}

// ---------------------------------------------------------------- helpers

async function visibleEmployee(db: Db, actor: Actor, id: string): Promise<repo.EmployeeRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const employee = await repo.findEmployee(db, id, employeesVisibleTo(actor));
  if (!employee) throw new AppError("NOT_FOUND");
  return employee;
}

async function workSchedule(db: Db, id: string): Promise<WorkSchedule> {
  const [shifts, daysOff] = await Promise.all([
    repo.findShifts(db, id),
    repo.listDaysOff(db, id, calendarDateInTimeZone(env.GYM_TIMEZONE)),
  ]);
  return { shifts: shifts.map(toShift), daysOff };
}

/** Checks the option choices and the linked login, and builds the row to store. */
async function toWrite(
  db: Db,
  data: EmployeeData,
  branchId: string,
  current: repo.EmployeeRecord | null,
): Promise<repo.EmployeeWrite> {
  const department = data.departmentId
    ? await resolveChoice(
        db,
        "departments",
        "departmentId",
        { optionId: data.departmentId, note: data.departmentNote },
        current?.departmentId,
      )
    : { optionId: null, note: null };
  const title = data.titleId
    ? await resolveChoice(
        db,
        "jobTitles",
        "titleId",
        { optionId: data.titleId, note: data.titleNote },
        current?.titleId,
      )
    : { optionId: null, note: null };
  await assertLinkable(db, data.userId, current?.id ?? null);
  return {
    branchId,
    fullName: data.fullName,
    birthDate: data.birthDate,
    gender: data.gender,
    phone: data.phone,
    email: data.email,
    departmentId: department.optionId,
    departmentNote: department.note,
    team: data.team,
    titleId: title.optionId,
    titleNote: title.note,
    status: data.status,
    isTrainer: data.isTrainer,
    userId: data.userId,
  };
}

/** Brief §8.4: each employee has one login, and a login belongs to one employee at most. */
async function assertLinkable(db: Db, userId: string | null, employeeId: string | null): Promise<void> {
  if (!userId) return;
  if ((await repo.userExists(db, userId)) === 0) throw linkError("invalidChoice");
  const linked = await repo.findEmployeeByUserId(db, userId);
  if (linked && linked.id !== employeeId) throw linkError("userAlreadyLinked");
}

/** Two requests linking the same login at once: the unique index decides. */
async function withLinkConflictsMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error)) throw linkError("userAlreadyLinked");
    throw error;
  }
}

/** The pre-check runs in the schema; the exclusion constraint has the last word. */
async function withShiftOverlapMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isExclusionViolation(error))
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { shifts: ["shiftsOverlap"] } });
    throw error;
  }
}

function linkError(key: string): AppError {
  return new AppError("VALIDATION_FAILED", { fieldErrors: { userId: [key] } });
}

function toShift(row: repo.ShiftRow) {
  return { weekday: row.weekday, start: timeOfMinutes(row.startMinute), end: timeOfMinutes(row.endMinute) };
}

/** Shifts as the action history shows them, e.g. "1 08:00–12:00" (ISO weekday first). */
function describeShifts(rows: readonly repo.ShiftRow[]): string {
  return rows
    .map((row) => `${row.weekday} ${timeOfMinutes(row.startMinute)}–${timeOfMinutes(row.endMinute)}`)
    .join(", ");
}

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}

function toView(employee: repo.EmployeeRecord): EmployeeView {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    branch: employee.branch,
    fullName: employee.fullName,
    birthDate: employee.birthDate,
    gender: employee.gender,
    phone: employee.phone,
    email: employee.email,
    department: employee.department && chosen(employee.department, employee.departmentNote),
    team: employee.team,
    title: employee.title && chosen(employee.title, employee.titleNote),
    status: employee.status,
    isTrainer: employee.isTrainer,
    user: employee.user,
  };
}
