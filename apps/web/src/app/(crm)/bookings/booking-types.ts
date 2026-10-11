import type { BookingStatus } from "@flow/shared/bookings";

// Shapes the booking screens pass from server to client components.

export type BookingPermissions = { manage: boolean; checkIn: boolean; complete: boolean };

/** An employee who teaches PT (D-030). */
export type TrainerOption = { id: string; employeeCode: string; fullName: string };

export type BookingRow = {
  id: string;
  status: BookingStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  customer: { id: string; customerCode: string; fullName: string };
  contract: { id: string; contractCode: string; packageName: string; remainingSessions: number };
  trainer: TrainerOption;
  session: { checkedInAt: Date; checkedInBy: string; completedAt: Date | null; completedBy: string | null } | null;
};
