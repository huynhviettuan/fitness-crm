import "server-only";
import { can } from "@flow/shared/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { listTrainers, trainerIdOfUser } from "@/modules/trainers/trainer.service";
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
    manage: can(user.role, "booking.manage"),
    checkIn: can(user.role, "session.checkIn"),
    complete: can(user.role, "session.complete"),
  };
  const active = (await listTrainers(user, { activeOnly: true })).map(({ id, trainerCode, fullName }) => ({
    id,
    trainerCode,
    fullName,
  }));
  if (user.role !== "TRAINER") return { permissions, trainers: active, unlinkedTrainer: false };

  const own = await trainerIdOfUser(user.id);
  return { permissions, trainers: active.filter((t) => t.id === own), unlinkedTrainer: own === null };
}
