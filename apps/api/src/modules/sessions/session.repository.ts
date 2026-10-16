import type { Db } from "../../platform/db/prisma.js";

/** Created at check-in; the unique booking_id allows one session per booking. */
export function createSession(
  db: Db,
  data: {
    bookingId: string;
    checkedInAt: Date;
    checkedInById: string | null;
    confirmationMethod?: "MANUAL" | "DEVICE";
  },
) {
  return db.session.create({ data, select: { id: true } });
}

export function recordCompletion(
  db: Db,
  bookingId: string,
  completedAt: Date,
  completedById: string | null,
  confirmationMethod: "MANUAL" | "DEVICE" = "MANUAL",
) {
  return db.session.update({
    where: { bookingId },
    data: { completedAt, completedById, confirmationMethod },
    select: { id: true },
  });
}
