import type { StatusColor } from "@flow/shared/bookings";

// Shapes the booking screens pass from server to client components.

export type BookingPermissions = {
  manage: boolean;
  delete: boolean;
  checkIn: boolean;
  complete: boolean;
  /** Delete a trained session from the history, and Burn Show: Admin's (D-026, D-028). */
  deleteHistory: boolean;
  burn: boolean;
};

/** An employee who teaches PT (D-030). */
export type TrainerOption = { id: string; employeeCode: string; fullName: string };

export type BookingRow = {
  id: string;
  status: string;
  statusRule: { labelVi: string; labelEn: string; color: StatusColor; locksOnSet: boolean };
  holdsSlot: boolean;
  addedByHand: boolean;
  checkedIn: boolean;
  scheduledStart: Date;
  scheduledEnd: Date;
  customer: { id: string; customerCode: string; fullName: string };
  contract: { id: string; contractCode: string; packageName: string; remainingSessions: number; frozen: boolean };
  trainer: TrainerOption;
  session: {
    checkedInAt: Date;
    checkedInBy: string | null;
    completedAt: Date | null;
    completedBy: string | null;
    confirmationMethod: "MANUAL" | "DEVICE";
  } | null;
};
