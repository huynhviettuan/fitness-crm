import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { lockContract } from "../contracts/contract.repository.js";

const bookingInclude = {
  customer: { select: { id: true, customerCode: true, fullName: true } },
  contract: {
    select: {
      id: true,
      contractCode: true,
      packageName: true,
      status: true,
      totalSessions: true,
      voucherSessions: true,
      bonusSessions: true,
      openingSessionsUsed: true,
      // T-050: the sessions used are the contract's bookings whose status consumed when it was set, and the class
      // attendances marked present (M5.5).
      _count: {
        select: { bookings: { where: { consumes: true } }, classAttendances: { where: { consumes: true } } },
      },
    },
  },
  trainer: { select: { id: true, employeeCode: true, fullName: true } },
  statusRule: { select: { labelVi: true, labelEn: true, color: true, locksOnSet: true } },
  session: {
    select: {
      checkedInAt: true,
      completedAt: true,
      confirmationMethod: true,
      checkedInBy: { select: { name: true } },
      completedBy: { select: { name: true } },
    },
  },
} as const satisfies Prisma.BookingInclude;

export type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export type BookingSlot = { trainerId: string; scheduledStart: Date; scheduledEnd: Date };

/**
 * Locks a booking for a change, in the order every booking change uses: its contract
 * first, then the booking (T-013, docs/22 §7). A booking's contract never changes,
 * so the contract read before locking is still its contract afterwards. Returns false
 * when the booking does not exist.
 */
export async function lockBooking(db: Db, id: string): Promise<boolean> {
  const [booking] = await db.$queryRaw<
    { contract_id: string }[]
  >`SELECT contract_id FROM bookings WHERE id = ${id}::uuid`;
  if (!booking) return false;
  await lockContract(db, booking.contract_id);
  await db.$queryRaw`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  return true;
}

export function findBooking(db: Db, id: string, visibility: Prisma.BookingWhereInput): Promise<BookingRecord | null> {
  return db.booking.findFirst({ where: { AND: [{ id }, visibility] }, include: bookingInclude });
}

export function createBooking(
  db: Db,
  data: BookingSlot & { customerId: string; contractId: string; branchId: string },
): Promise<BookingRecord> {
  return db.booking.create({ data, include: bookingInclude });
}

/** Burn Show (D-028): a booking born trained, by hand, with the rule of Đã tập applied now (T-050). */
export function createTrainedBooking(
  db: Db,
  data: BookingSlot & {
    customerId: string;
    contractId: string;
    branchId: string;
    rule: StatusRule;
    actorId: string;
    reason: { optionId: string; note: string | null };
  },
): Promise<BookingRecord> {
  const { rule, actorId, reason, ...slot } = data;
  return db.booking.create({
    data: {
      ...slot,
      status: rule.code,
      consumes: rule.consumes,
      creditsPt: rule.creditsPt,
      holdsSlot: rule.holdsSlot,
      statusSetAt: new Date(),
      statusSetById: actorId,
      addedByHand: true,
      addedReasonId: reason.optionId,
      addedReasonNote: reason.note,
    },
    include: bookingInclude,
  });
}

/** Marks a trained session deleted from the check-in history, for the PT's payroll adjustment (D-027). */
export function markHistoryDeleted(db: Db, id: string, at: Date, actorId: string) {
  return db.booking.update({
    where: { id },
    data: { historyDeletedAt: at, historyDeletedById: actorId },
    select: { id: true },
  });
}

/** A session status and its rule, as configured now. */
export type StatusRule = Prisma.SessionStatusGetPayload<object>;

export function findStatusRule(db: Db, code: string): Promise<StatusRule | null> {
  return db.sessionStatus.findUnique({ where: { code } });
}

export function listStatusRules(db: Db): Promise<StatusRule[]> {
  return db.sessionStatus.findMany({ orderBy: { sortOrder: "asc" } });
}

/**
 * Sets the status only if it is still `from`, and keeps the flags of the rule applied now (T-050), with when and by
 * whom. Returns rows changed.
 */
export async function setStatus(
  db: Db,
  id: string,
  from: string,
  rule: StatusRule,
  actorId: string | null,
): Promise<number> {
  const { count } = await db.booking.updateMany({
    where: { id, status: from },
    data: {
      status: rule.code,
      consumes: rule.consumes,
      creditsPt: rule.creditsPt,
      holdsSlot: rule.holdsSlot,
      statusSetAt: new Date(),
      statusSetById: actorId,
    },
  });
  return count;
}

/** Changes trainer and time only while the booking is still Booked and not checked in (A-006). Returns rows changed. */
export async function rescheduleBooked(db: Db, id: string, slot: BookingSlot): Promise<number> {
  const { count } = await db.booking.updateMany({ where: { id, status: "BOOKED", session: { is: null } }, data: slot });
  return count;
}

/**
 * An active booking of the trainer that overlaps the half-open range [start, end)
 * (A-004, A-005). The exclusion constraint enforces the same rule (T-014); this check
 * only gives a clear error before the insert.
 */
export function findOverlappingBooking(db: Db, slot: BookingSlot, excludeId?: string) {
  return db.booking.findFirst({
    where: {
      trainerId: slot.trainerId,
      holdsSlot: true,
      scheduledStart: { lt: slot.scheduledEnd },
      scheduledEnd: { gt: slot.scheduledStart },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });
}

/** An active booking of the customer that overlaps the range, whoever the trainer (M5.2). */
export function findOverlappingCustomerBooking(db: Db, customerId: string, slot: BookingSlot, excludeId?: string) {
  return db.booking.findFirst({
    where: {
      customerId,
      holdsSlot: true,
      scheduledStart: { lt: slot.scheduledEnd },
      scheduledEnd: { gt: slot.scheduledStart },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });
}

/** Sessions of the customer on the service that hold their time and start inside [from, to) (A-149). */
export function countServiceBookings(
  db: Db,
  where: { customerId: string; serviceId: string; from: Date; to: Date; excludeId?: string },
): Promise<number> {
  return db.booking.count({
    where: {
      customerId: where.customerId,
      holdsSlot: true,
      contract: { serviceId: where.serviceId },
      scheduledStart: { gte: where.from, lt: where.to },
      ...(where.excludeId && { id: { not: where.excludeId } }),
    },
  });
}

export function countBookingsOfContract(db: Db, contractId: string, statuses: readonly string[]): Promise<number> {
  return db.booking.count({ where: { contractId, status: { in: [...statuses] } } });
}

/** Booked sessions of the contract the customer has checked in to (D-010). */
export function countCheckedInBookings(db: Db, contractId: string): Promise<number> {
  return db.booking.count({ where: { contractId, status: "BOOKED", session: { isNot: null } } });
}

/** D-010: cancels every Booked booking of the contract, with the rule of Hủy lịch. Returns their ids. */
export async function cancelBookedBookingsOfContract(
  db: Db,
  contractId: string,
  rule: StatusRule,
  actorId: string,
): Promise<string[]> {
  const booked = await db.booking.findMany({ where: { contractId, status: "BOOKED" }, select: { id: true } });
  const ids = booked.map((b) => b.id);
  for (const id of ids) await setStatus(db, id, "BOOKED", rule, actorId);
  return ids;
}

/** M8.1: cancels the Booked sessions of a contract that start inside a range (a hold), with the rule of Hủy lịch. */
export async function cancelBookedBookingsInRange(
  db: Db,
  contractId: string,
  range: { from: Date; to: Date },
  rule: StatusRule,
  actorId: string,
): Promise<string[]> {
  const booked = await db.booking.findMany({
    where: { contractId, status: "BOOKED", scheduledStart: { gte: range.from, lt: range.to } },
    select: { id: true },
  });
  const ids = booked.map((b) => b.id);
  for (const id of ids) await setStatus(db, id, "BOOKED", rule, actorId);
  return ids;
}

export async function listBookings(
  db: Db,
  where: Prisma.BookingWhereInput,
  options: { order: "asc" | "desc"; skip: number; take: number },
) {
  const [items, total] = await Promise.all([
    db.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ scheduledStart: options.order }, { createdAt: "asc" }],
      skip: options.skip,
      take: options.take,
    }),
    db.booking.count({ where }),
  ]);
  return { items, total };
}
