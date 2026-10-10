import type { Db } from "@/lib/db/prisma";

/** Created at check-in; the unique booking_id allows one session per booking. */
export function createSession(db: Db, data: { bookingId: string; checkedInAt: Date; checkedInById: string }) {
  return db.session.create({ data, select: { id: true } });
}

export function recordCompletion(db: Db, bookingId: string, completedAt: Date, completedById: string) {
  return db.session.update({ where: { bookingId }, data: { completedAt, completedById }, select: { id: true } });
}
