import type { Db } from "../../platform/db/prisma.js";
import type { BookingStatus, Prisma } from "../../generated/prisma/client.js";
import { lockContract } from "../contracts/contract.repository.js";
import { ACTIVE_BOOKING_STATUSES } from "@flow/shared/bookings";

const bookingInclude = {
  customer: { select: { id: true, customerCode: true, fullName: true } },
  contract: {
    select: {
      id: true,
      contractCode: true,
      packageName: true,
      totalSessions: true,
      openingSessionsUsed: true,
      // T-012: completed sessions are the contract's bookings in COMPLETED.
      _count: { select: { bookings: { where: { status: "COMPLETED" } } } },
    },
  },
  trainer: { select: { id: true, trainerCode: true, fullName: true } },
  session: {
    select: {
      checkedInAt: true,
      completedAt: true,
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
  const [booking] = await db.$queryRaw<{ contract_id: string }[]>`SELECT contract_id FROM bookings WHERE id = ${id}::uuid`;
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

/** Moves the status only if it is still `from`. Returns rows changed. */
export async function moveStatus(db: Db, id: string, from: BookingStatus, to: BookingStatus): Promise<number> {
  const { count } = await db.booking.updateMany({ where: { id, status: from }, data: { status: to } });
  return count;
}

/** Changes trainer and time only while the booking is still BOOKED (A-006). Returns rows changed. */
export async function rescheduleBooked(db: Db, id: string, slot: BookingSlot): Promise<number> {
  const { count } = await db.booking.updateMany({ where: { id, status: "BOOKED" }, data: slot });
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
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      scheduledStart: { lt: slot.scheduledEnd },
      scheduledEnd: { gt: slot.scheduledStart },
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });
}

export function countBookingsOfContract(db: Db, contractId: string, statuses: readonly BookingStatus[]): Promise<number> {
  return db.booking.count({ where: { contractId, status: { in: [...statuses] } } });
}

/** D-010: cancels every BOOKED booking of the contract. Returns their ids. */
export async function cancelBookedBookingsOfContract(db: Db, contractId: string): Promise<string[]> {
  const booked = await db.booking.findMany({ where: { contractId, status: "BOOKED" }, select: { id: true } });
  const ids = booked.map((b) => b.id);
  if (ids.length > 0) {
    await db.booking.updateMany({ where: { id: { in: ids }, status: "BOOKED" }, data: { status: "CANCELLED" } });
  }
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
