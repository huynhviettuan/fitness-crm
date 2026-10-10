import "server-only";
import { can } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { listTrainers } from "@/lib/api/trainers";
import type { BookingPermissions, TrainerOption } from "./booking-types";

export type BookingContext = {
  permissions: BookingPermissions;
  /** Trainers a booking can be given to: the active ones, or only the trainer's own (A-007). */
  trainers: TrainerOption[];
  /** A trainer login with no trainer record (A-010) can see and do nothing with bookings. */
  unlinkedTrainer: boolean;
};

/** What every booking screen needs to know about the signed-in user. */
export async function bookingContext(user: CurrentUser): Promise<BookingContext> {
  const permissions: BookingPermissions = {
    manage: can(user, "booking.manage"),
    checkIn: can(user, "session.checkIn"),
    complete: can(user, "session.complete"),
  };
  const active = (await listTrainers({ activeOnly: true })).map(({ id, trainerCode, fullName }) => ({
    id,
    trainerCode,
    fullName,
  }));
  if (user.role !== "TRAINER") return { permissions, trainers: active, unlinkedTrainer: false };

  const own = user.trainerId;
  return { permissions, trainers: active.filter((t) => t.id === own), unlinkedTrainer: own === null };
}
