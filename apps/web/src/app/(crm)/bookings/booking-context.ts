import "server-only";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { formatDateOnly } from "@/lib/format";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import type { CurrentUser } from "@/lib/auth/current-user";
import { listTrainersOfDay } from "@/lib/api/employees";
import type { BookingPermissions, TrainerOption } from "./booking-types";

export type WorkingHours = { start: string; end: string }[];

export type BookingContext = {
  permissions: BookingPermissions;
  /** Trainers a booking can be given to: the active ones, or only the PT themselves (D-017). */
  trainers: TrainerOption[];
  /** Each trainer's working hours on `day` (D-030), by trainer id; empty on a day off. */
  workingHours: Map<string, WorkingHours>;
  /** The branch each trainer works in, for the calendar's branch filter. */
  branchOf: Map<string, string>;
  /** A PT login that belongs to no employee yet can see and do nothing with bookings. */
  unlinkedTrainer: boolean;
};

/** What every booking screen needs to know about the signed-in user, for one gym day (default today). */
export async function bookingContext(
  user: CurrentUser,
  day: string = formatDateOnly(calendarDateInTimeZone(env.GYM_TIMEZONE)),
): Promise<BookingContext> {
  const permissions: BookingPermissions = {
    manage: can(user, "booking.manage"),
    delete: can(user, "booking.delete"),
    checkIn: can(user, "session.checkIn"),
    complete: can(user, "session.complete"),
  };
  // The API already keeps a PT to their own row (schedule scope "only mine").
  const days = await listTrainersOfDay(day);
  return {
    permissions,
    trainers: days.map((entry) => entry.trainer),
    workingHours: new Map(days.map((entry) => [entry.trainer.id, entry.workingHours])),
    branchOf: new Map(days.map((entry) => [entry.trainer.id, entry.branchId])),
    unlinkedTrainer: user.dataScopes.schedule === "OWN" && user.employeeId === null,
  };
}
