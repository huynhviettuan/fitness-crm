import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { ErrorCode } from "@flow/shared/errors";
import { assertCan } from "../../platform/permissions/assert.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { findContract, usedSessionsOf } from "../contracts/contract.repository.js";
import { contractView, type ContractView } from "../contracts/contract.service.js";
import { findStatusRule, setStatus, type BookingRecord } from "../bookings/booking.repository.js";
import {
  canCheckIn,
  canComplete,
  completeDaySchema,
  isWithinContractPeriod,
  type CompleteDayResult,
} from "@flow/shared/bookings";
import { parseInput } from "../../platform/validation/parse.js";
import { entitledSessions } from "@flow/shared/contracts";
import {
  bookingView,
  changeLockedBooking,
  factsOf,
  sessionDay,
  toBookingView,
  type BookingView,
} from "../bookings/booking.service.js";
import { createSession, recordCompletion } from "./session.repository.js";

export type CompletionResult = { booking: BookingView; contract: ContractView };

/**
 * Manual check-in (D-003): the session record is created and the booking stays Booked (D-025: check-in is a fact, not
 * a status). It does not consume a session (BR-005). A repeat returns the current state.
 */
export async function checkIn(actor: Actor, bookingId: string): Promise<BookingView> {
  assertCan(actor, "session.checkIn");
  return changeLockedBooking(actor, bookingId, async (tx, before) => {
    if (before.status === "BOOKED" && before.session) return toBookingView(before);
    if (!canCheckIn(factsOf(before))) throw new AppError("INVALID_STATUS_TRANSITION");
    if (before.contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    await createSession(tx, { bookingId, checkedInAt: new Date(), checkedInById: actor.id });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "booking",
      entityId: bookingId,
      action: "booking.checked_in",
      before: { status: before.status, checkedIn: false },
      after: { status: before.status, checkedIn: true },
      context: { contractId: before.contractId },
    });
    return bookingView(tx, actor, bookingId);
  });
}

/**
 * Completes a Booked session by hand: it becomes Đã tập and consumes exactly one session of its contract by the rule of
 * that status (BR-006, D-025). The locked transaction from docs/22 §7 (T-013) makes this safe when it is repeated or
 * sent many times at once (BR-007), and when the last sessions of a contract are completed together (BR-009).
 */
export async function completeSession(actor: Actor, bookingId: string): Promise<CompletionResult> {
  assertCan(actor, "session.complete");
  return changeLockedBooking(actor, bookingId, async (tx, booking) => {
    const result = async () => ({
      booking: await bookingView(tx, actor, bookingId),
      contract: await contractView(tx, actor, booking.contractId),
    });

    // Already trained: return it, consuming nothing and auditing nothing.
    if (booking.status === "TRAINED") return result();
    if (!canComplete(factsOf(booking))) throw new AppError("INVALID_STATUS_TRANSITION");
    await confirmBooking(tx, booking, { method: "MANUAL", actorId: actor.id });
    return result();
  });
}

/** How a session was confirmed, and by whom: a person, or null for a paired device scan (D-069). */
export type Confirmation = { method: "MANUAL" | "DEVICE"; actorId: string | null; context?: Record<string, unknown> };

/**
 * Why a booking cannot take a session off its contract now, or null (BR-006, D-023, D-070): the contract is cancelled,
 * deactivated, does not cover the session's day, or has no sessions left.
 */
export async function sessionProblem(
  db: Db,
  booking: Pick<BookingRecord, "contractId" | "scheduledStart">,
): Promise<{ code: ErrorCode | null; remaining: number; contractId: string }> {
  const contract = await findContract(db, booking.contractId, {});
  if (!contract) throw new AppError("NOT_FOUND");
  // D-011: sessions used before go-live count too.
  const remaining =
    entitledSessions(contract.totalSessions, contract.bonusSessions) -
    contract.openingSessionsUsed -
    usedSessionsOf(contract);
  const found = (code: ErrorCode | null) => ({ code, remaining, contractId: contract.id });
  // Cannot happen while D-010 holds (a contract with a checked-in booking cannot be cancelled); kept so a session is
  // never consumed from a cancelled contract.
  if (contract.status === "CANCELLED") return found("CONTRACT_NOT_ACTIVE");
  // No session is consumed while the contract is deactivated (D-023).
  if (contract.status === "FROZEN") return found("CONTRACT_FROZEN");
  if (!isWithinContractPeriod(sessionDay(booking.scheduledStart), contract)) {
    return found("BOOKING_OUTSIDE_CONTRACT_PERIOD");
  }
  if (remaining <= 0) return found("CONTRACT_NO_REMAINING_SESSIONS");
  return found(null);
}

/**
 * The one event "session confirmed" (D-069): the manual Đã tập, the bulk one, and a paired device scan all end here.
 * It takes the session off the contract and credits the PT by the rule of Đã tập (the customer email follows with
 * M6.2). The caller holds the contract and booking locks and has checked the booking is Booked.
 */
export async function confirmBooking(
  tx: Prisma.TransactionClient,
  booking: BookingRecord,
  confirmation: Confirmation,
): Promise<void> {
  const problem = await sessionProblem(tx, booking);
  if (problem.code) throw new AppError(problem.code);
  const rule = await findStatusRule(tx, "TRAINED");
  if (!rule) throw new AppError("INTERNAL_ERROR");
  if ((await setStatus(tx, booking.id, "BOOKED", rule, confirmation.actorId)) !== 1) {
    throw new AppError("INVALID_STATUS_TRANSITION");
  }
  // D-026: there is no separate check-in step; completing a session nobody checked in to records both at once.
  const now = new Date();
  if (!booking.session) {
    await createSession(tx, {
      bookingId: booking.id,
      checkedInAt: now,
      checkedInById: confirmation.actorId,
      confirmationMethod: confirmation.method,
    });
  }
  await recordCompletion(tx, booking.id, now, confirmation.actorId, confirmation.method);
  await recordAudit(tx, {
    actorUserId: confirmation.actorId,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.completed",
    before: { status: "BOOKED" },
    after: { status: "TRAINED", consumes: rule.consumes, creditsPt: rule.creditsPt },
    context: {
      contractId: problem.contractId,
      remainingSessions: problem.remaining - (rule.consumes ? 1 : 0),
      method: confirmation.method,
      ...confirmation.context,
    },
  });
}

/**
 * Bulk "Đã tập" for a day (M5.3): each session goes through the same single path as one by one, in its own
 * transaction, so one that cannot be completed (no sessions left, frozen) does not stop or undo the others.
 */
export async function completeSessions(actor: Actor, rawInput: unknown): Promise<CompleteDayResult> {
  assertCan(actor, "session.complete");
  const { bookingIds } = parseInput(completeDaySchema, rawInput);
  const items: CompleteDayResult["items"] = [];
  for (const bookingId of new Set(bookingIds)) {
    try {
      await completeSession(actor, bookingId);
      items.push({ bookingId, ok: true, code: null });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      items.push({ bookingId, ok: false, code: error.code });
    }
  }
  return { completed: items.filter((item) => item.ok).length, items };
}
