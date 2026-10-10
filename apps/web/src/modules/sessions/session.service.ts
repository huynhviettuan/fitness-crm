import "server-only";
import { AppError } from "@/lib/errors/app-error";
import { assertCan } from "@/lib/permissions/assert";
import type { Actor } from "@/lib/auth/session";
import { recordAudit } from "@/modules/audit/audit.repository";
import { findContract } from "@/modules/contracts/contract.repository";
import { contractView, type ContractView } from "@/modules/contracts/contract.service";
import { moveStatus } from "@/modules/bookings/booking.repository";
import { canCheckIn, canComplete, isWithinContractPeriod } from "@flow/shared/bookings";
import {
  bookingView,
  changeLockedBooking,
  sessionDay,
  transitionBooking,
  type BookingView,
} from "@/modules/bookings/booking.service";
import { createSession, recordCompletion } from "@/modules/sessions/session.repository";

export type CompletionResult = { booking: BookingView; contract: ContractView };

/**
 * Manual check-in (D-003): BOOKED → CHECKED_IN and the session record is created. Does
 * not consume a session (BR-005). A repeat returns the current state.
 */
export async function checkIn(actor: Actor, bookingId: string): Promise<BookingView> {
  assertCan(actor, "session.checkIn");
  return transitionBooking(actor, bookingId, {
    to: "CHECKED_IN",
    allowed: canCheckIn,
    action: "booking.checked_in",
    apply: (tx) => createSession(tx, { bookingId, checkedInAt: new Date(), checkedInById: actor.id }),
  });
}

/**
 * Completes a checked-in session and so consumes exactly one session of its contract
 * (BR-006). The locked transaction from docs/22 §7 (T-013) makes this safe when it is
 * repeated or sent many times at once (BR-007), and when the last sessions of a
 * contract are completed together (BR-009).
 */
export async function completeSession(actor: Actor, bookingId: string): Promise<CompletionResult> {
  assertCan(actor, "session.complete");
  return changeLockedBooking(actor, bookingId, async (tx, booking) => {
    const result = async () => ({
      booking: await bookingView(tx, actor, bookingId),
      contract: await contractView(tx, actor, booking.contractId),
    });

    // Already completed: return it, consuming nothing and auditing nothing.
    if (booking.status === "COMPLETED") return result();
    if (!canComplete(booking.status)) throw new AppError("INVALID_STATUS_TRANSITION");

    const contract = await findContract(tx, booking.contractId, {});
    if (!contract) throw new AppError("NOT_FOUND");
    // Cannot happen while D-010 holds (a contract with a checked-in booking cannot be
    // cancelled); kept so a session is never consumed from a cancelled contract.
    if (contract.status === "CANCELLED") throw new AppError("CONTRACT_NOT_ACTIVE");
    if (!isWithinContractPeriod(sessionDay(booking.scheduledStart), contract)) {
      throw new AppError("BOOKING_OUTSIDE_CONTRACT_PERIOD");
    }
    // D-011: sessions used before go-live count too.
    const remaining = contract.totalSessions - contract.openingSessionsUsed - contract._count.bookings;
    if (remaining <= 0) throw new AppError("CONTRACT_NO_REMAINING_SESSIONS");

    if ((await moveStatus(tx, bookingId, "CHECKED_IN", "COMPLETED")) !== 1) {
      throw new AppError("INVALID_STATUS_TRANSITION");
    }
    await recordCompletion(tx, bookingId, new Date(), actor.id);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "booking",
      entityId: bookingId,
      action: "booking.completed",
      metadata: { from: "CHECKED_IN", to: "COMPLETED", contractId: contract.id, remainingSessions: remaining - 1 },
    });
    return result();
  });
}
