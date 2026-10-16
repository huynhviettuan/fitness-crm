import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { formatEmployeeCode } from "@gymcrm/shared/employees";
import { normalizeForSearch, normalizePhone } from "@gymcrm/shared/validation";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { chosenSelect } from "../../platform/options/option.service.js";

const withRefs = {
  user: { select: { id: true, name: true, email: true } },
  branch: { select: { id: true, name: true } },
  department: { select: chosenSelect },
  title: { select: chosenSelect },
  manager: { select: { id: true, employeeCode: true, fullName: true } },
} as const satisfies Prisma.EmployeeInclude;

export type EmployeeRecord = Prisma.EmployeeGetPayload<{ include: typeof withRefs }>;

/** The stored fields of an employee; the code is generated once and never written again. */
export type EmployeeWrite = {
  branchId: string;
  fullName: string;
  birthDate: Date | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  phone: string | null;
  email: string | null;
  departmentId: string | null;
  departmentNote: string | null;
  team: string | null;
  titleId: string | null;
  titleNote: string | null;
  managerId: string | null;
  status: "ACTIVE" | "INACTIVE";
  isTrainer: boolean;
  userId: string | null;
};

/** A shift as stored: minutes after midnight, end exclusive. */
export type ShiftRow = { weekday: number; startMinute: number; endMinute: number };

/**
 * Draws the next code from the sequence; concurrent callers never get the same value.
 * The prefix is configuration (D-038); the number never repeats, whatever the prefix.
 */
export async function nextEmployeeCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('employee_code_seq') AS value`;
  return formatEmployeeCode(await readParameter(db, "employeeCodePrefix"), row.value);
}

export function createEmployee(db: Db, employeeCode: string, data: EmployeeWrite): Promise<EmployeeRecord> {
  return db.employee.create({
    data: { ...data, employeeCode, searchName: normalizeForSearch(data.fullName) },
    include: withRefs,
  });
}

export function updateEmployee(db: Db, id: string, data: EmployeeWrite): Promise<EmployeeRecord> {
  return db.employee.update({
    where: { id },
    data: { ...data, searchName: normalizeForSearch(data.fullName) },
    include: withRefs,
  });
}

export function findEmployee(
  db: Db,
  id: string,
  visibility: Prisma.EmployeeWhereInput = {},
): Promise<EmployeeRecord | null> {
  return db.employee.findFirst({ where: { AND: [{ id }, visibility] }, include: withRefs });
}

/** Holds the employee's row until the transaction ends, so schedule changes run one at a time. */
export async function lockEmployee(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "employees" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

/** The direct managers above an employee, nearest first, for the cycle check (D-046). */
export async function managerChain(db: Db, employeeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT "manager_id", 1 FROM "employees" WHERE "id" = ${employeeId}::uuid AND "manager_id" IS NOT NULL
      UNION
      SELECT e."manager_id", c.depth + 1 FROM "employees" e JOIN chain c ON e."id" = c.id
      WHERE e."manager_id" IS NOT NULL AND c.depth < 50
    )
    SELECT id::text FROM chain ORDER BY depth`;
  return rows.map((row) => row.id);
}

export function employeeExists(db: Db, id: string): Promise<number> {
  return db.employee.count({ where: { id } });
}

export function findEmployeeByUserId(db: Db, userId: string) {
  return db.employee.findUnique({ where: { userId }, select: { id: true } });
}

/** Search by code, name without diacritics, or phone digits. */
export function searchWhere(q: string): Prisma.EmployeeWhereInput {
  if (!q) return {};
  const phoneTerm = normalizePhone(q);
  return {
    OR: [
      { employeeCode: { contains: q, mode: "insensitive" } },
      { searchName: { contains: normalizeForSearch(q) } },
      ...(/^\+?\d+$/.test(phoneTerm) ? [{ phone: { contains: phoneTerm } }] : []),
    ],
  };
}

export async function listEmployees(
  db: Db,
  where: Prisma.EmployeeWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: EmployeeRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.employee.findMany({
      where,
      include: withRefs,
      orderBy: [{ status: "asc" }, { fullName: "asc" }, { employeeCode: "asc" }],
      ...page,
    }),
    db.employee.count({ where }),
  ]);
  return { items, total };
}

/** Every login, with the employee each belongs to, if any (brief §8.4). */
export function listLogins(db: Db) {
  return db.user.findMany({
    select: { id: true, name: true, email: true, employee: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
}

export function userExists(db: Db, userId: string): Promise<number> {
  return db.user.count({ where: { id: userId } });
}

// ---------------------------------------------------------------- working schedule

export function findShifts(db: Db, employeeId: string): Promise<ShiftRow[]> {
  return db.employeeShift.findMany({
    where: { employeeId },
    select: { weekday: true, startMinute: true, endMinute: true },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  });
}

export async function replaceShifts(db: Db, employeeId: string, shifts: ShiftRow[]): Promise<void> {
  await db.employeeShift.deleteMany({ where: { employeeId } });
  await db.employeeShift.createMany({ data: shifts.map((shift) => ({ ...shift, employeeId })) });
}

export function listDaysOff(db: Db, employeeId: string, from: Date) {
  return db.employeeDayOff.findMany({
    where: { employeeId, date: { gte: from } },
    select: { id: true, date: true, note: true },
    orderBy: { date: "asc" },
  });
}

export function createDayOff(db: Db, employeeId: string, data: { date: Date; note: string | null }) {
  return db.employeeDayOff.create({ data: { ...data, employeeId }, select: { id: true, date: true, note: true } });
}

export function findDayOff(db: Db, employeeId: string, id: string) {
  return db.employeeDayOff.findFirst({ where: { id, employeeId }, select: { id: true, date: true, note: true } });
}

export function deleteDayOff(db: Db, id: string) {
  return db.employeeDayOff.delete({ where: { id } });
}

export async function isDayOff(db: Db, employeeId: string, date: Date): Promise<boolean> {
  return (await db.employeeDayOff.count({ where: { employeeId, date } })) > 0;
}

/** Active trainers with their shifts of one weekday, and whether `date` is a day off for them. */
export function trainersWithDay(db: Db, where: Prisma.EmployeeWhereInput, weekday: number, date: Date) {
  return db.employee.findMany({
    where: { AND: [where, { isTrainer: true, status: "ACTIVE" }] },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      branchId: true,
      shifts: { where: { weekday }, select: { weekday: true, startMinute: true, endMinute: true } },
      daysOff: { where: { date }, select: { id: true } },
    },
    orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
  });
}
