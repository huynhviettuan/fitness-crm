import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";

const classInclude = {
  branch: { select: { id: true, name: true } },
  coach: { select: { id: true, employeeCode: true, fullName: true } },
} as const satisfies Prisma.GymClassInclude;

export type ClassRecord = Prisma.GymClassGetPayload<{ include: typeof classInclude }>;

export function findClass(db: Db, id: string, visibility: Prisma.GymClassWhereInput = {}): Promise<ClassRecord | null> {
  return db.gymClass.findFirst({ where: { AND: [{ id }, visibility] }, include: classInclude });
}

export function listClasses(db: Db, where: Prisma.GymClassWhereInput): Promise<ClassRecord[]> {
  return db.gymClass.findMany({
    where,
    include: classInclude,
    orderBy: [{ active: "desc" }, { name: "asc" }, { startTime: "asc" }],
  });
}

export function createClass(
  db: Db,
  data: Pick<
    Prisma.GymClassUncheckedCreateInput,
    "branchId" | "name" | "coachId" | "capacity" | "weekdays" | "startTime" | "endTime"
  >,
): Promise<ClassRecord> {
  return db.gymClass.create({ data, include: classInclude });
}

export function updateClass(
  db: Db,
  id: string,
  data: { name: string; coachId: string; capacity: number; active: boolean },
): Promise<ClassRecord> {
  return db.gymClass.update({ where: { id }, data, include: classInclude });
}

export function activeClasses(db: Db): Promise<
  {
    id: string;
    branchId: string;
    coachId: string;
    capacity: number;
    weekdays: number[];
    startTime: string;
    endTime: string;
  }[]
> {
  return db.gymClass.findMany({
    where: { active: true },
    select: { id: true, branchId: true, coachId: true, capacity: true, weekdays: true, startTime: true, endTime: true },
  });
}

/** Inserts the sessions that are not there yet; the unique (class, start) makes a rerun add nothing. */
export async function insertSessions(
  db: Db,
  rows: { classId: string; branchId: string; coachId: string; capacity: number; startsAt: Date; endsAt: Date }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { count } = await db.classSession.createMany({ data: rows, skipDuplicates: true });
  return count;
}

const sessionInclude = {
  gymClass: { select: { name: true } },
  branch: { select: { id: true, name: true } },
  coach: { select: { id: true, employeeCode: true, fullName: true } },
  attendances: {
    orderBy: { enrolledAt: "asc" },
    include: {
      customer: { select: { id: true, customerCode: true, fullName: true } },
      contract: {
        select: {
          id: true,
          contractCode: true,
          packageName: true,
          totalSessions: true,
          voucherSessions: true,
          bonusSessions: true,
          openingSessionsUsed: true,
          _count: {
            select: { bookings: { where: { consumes: true } }, classAttendances: { where: { consumes: true } } },
          },
        },
      },
      markedBy: { select: { name: true } },
    },
  },
} as const satisfies Prisma.ClassSessionInclude;

export type ClassSessionRecord = Prisma.ClassSessionGetPayload<{ include: typeof sessionInclude }>;

export function findSession(
  db: Db,
  id: string,
  visibility: Prisma.ClassSessionWhereInput = {},
): Promise<ClassSessionRecord | null> {
  return db.classSession.findFirst({ where: { AND: [{ id }, visibility] }, include: sessionInclude });
}

export function listSessions(db: Db, where: Prisma.ClassSessionWhereInput): Promise<ClassSessionRecord[]> {
  return db.classSession.findMany({
    where,
    include: sessionInclude,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: 1000,
  });
}

/** Holds the session's row until the transaction ends, so seats are given out one request at a time (BR-411). */
export async function lockSession(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM class_sessions WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

/** Holds the attendance row, and returns its session and contract so the caller can lock in order (contract first). */
export async function attendanceOwners(db: Db, id: string): Promise<{ contractId: string; sessionId: string } | null> {
  const row = await db.classAttendance.findUnique({
    where: { id },
    select: { contractId: true, classSessionId: true },
  });
  return row && { contractId: row.contractId, sessionId: row.classSessionId };
}

export function countSeats(db: Db, classSessionId: string): Promise<number> {
  return db.classAttendance.count({ where: { classSessionId, status: { in: ["ENROLLED", "PRESENT"] } } });
}

export function countOpenEnrollments(db: Db, contractId: string): Promise<number> {
  return db.classAttendance.count({ where: { contractId, status: "ENROLLED", classSession: { status: "SCHEDULED" } } });
}

export function insertAttendance(
  db: Db,
  data: { classSessionId: string; customerId: string; contractId: string; enrolledById: string },
) {
  return db.classAttendance.create({ data, select: { id: true } });
}

export function findAttendance(db: Db, id: string, classSessionId: string) {
  return db.classAttendance.findFirst({ where: { id, classSessionId } });
}

export function deleteAttendance(db: Db, id: string) {
  return db.classAttendance.delete({ where: { id }, select: { id: true } });
}

export async function markAttendance(
  db: Db,
  id: string,
  from: string,
  data: { status: "PRESENT" | "ABSENT"; markedById: string; markedAt: Date },
): Promise<number> {
  const { count } = await db.classAttendance.updateMany({
    where: { id, status: from },
    data: {
      status: data.status,
      consumes: data.status === "PRESENT",
      markedById: data.markedById,
      markedAt: data.markedAt,
    },
  });
  return count;
}

/** Future sessions of a class that nobody is enrolled in: they can be cancelled or changed freely. */
export async function cancelEmptyFutureSessions(db: Db, classId: string, from: Date): Promise<number> {
  const { count } = await db.classSession.updateMany({
    where: { classId, startsAt: { gte: from }, status: "SCHEDULED", attendances: { none: {} } },
    data: { status: "CANCELLED" },
  });
  return count;
}

export async function reviveFutureSessions(db: Db, classId: string, from: Date): Promise<number> {
  const { count } = await db.classSession.updateMany({
    where: { classId, startsAt: { gte: from }, status: "CANCELLED" },
    data: { status: "SCHEDULED" },
  });
  return count;
}

export async function updateFutureSessions(
  db: Db,
  classId: string,
  from: Date,
  data: { coachId: string; capacity: number },
): Promise<number> {
  const { count } = await db.classSession.updateMany({
    where: { classId, startsAt: { gte: from }, status: "SCHEDULED" },
    data,
  });
  return count;
}

/** The most seats any future session of the class already holds, so the capacity is never set below it. */
export async function maxFutureSeats(db: Db, classId: string, from: Date): Promise<number> {
  const rows = await db.$queryRaw<{ seats: number }[]>`
    SELECT COUNT(*)::int AS seats
    FROM class_attendances a
    JOIN class_sessions s ON s.id = a.class_session_id
    WHERE s.class_id = ${classId}::uuid AND s.starts_at >= ${from} AND s.status = 'SCHEDULED' AND a.status IN ('ENROLLED', 'PRESENT')
    GROUP BY s.id
    ORDER BY seats DESC
    LIMIT 1`;
  return rows[0]?.seats ?? 0;
}
