import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { moveToTrash } from "../../platform/trash/trash.service.js";
import { encode } from "../../platform/http/encode.js";
import { parseInput } from "../../platform/validation/parse.js";
import { deleteSchema } from "@flow/shared/trash";
import { bookingSchema, burnShowSchema, canDeleteFromHistory } from "@flow/shared/bookings";
import { findContract, lockContract } from "../contracts/contract.repository.js";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import {
  createTrainedBooking,
  findStatusRule,
  markHistoryDeleted,
  setStatus,
  type BookingRecord,
} from "../bookings/booking.repository.js";
import {
  assertBookable,
  bookingView,
  changeLockedBooking,
  factsOf,
  sessionDay,
  toBookingView,
  toSlot,
  withOverlapMapped,
  type BookingView,
} from "../bookings/booking.service.js";
import { queueEmail } from "../mail/mail.service.js";
import { formatDay, sessionChangeEmail } from "./session-email.js";
import { sessionProblem } from "./session.service.js";
import { createSession, recordCompletion } from "./session.repository.js";

/**
 * Delete from the check-in history (D-026, BR-406): the one correction of a trained session. It needs a reason; the
 * session becomes Xóa, which consumes and credits nobody, so one session is refunded and the PT's credit is gone in
 * every report; the booking goes to the trash; and the customer is emailed (D-036). No approval (A-157). When the PT
 * was already paid for its period, `history_deleted_at` is what M5.7 turns into an adjustment of the next period
 * (D-027).
 */
export async function deleteTrainedSession(actor: Actor, bookingId: string, rawInput: unknown): Promise<void> {
  assertCan(actor, "session.deleteHistory");
  const { reasonId, reasonNote } = parseInput(deleteSchema, rawInput);
  await changeLockedBooking(actor, bookingId, async (tx, booking) => {
    if (!canDeleteFromHistory(factsOf(booking))) throw new AppError("INVALID_STATUS_TRANSITION");
    const reason = await resolveChoice(tx, "deleteReasons", "reasonId", { optionId: reasonId, note: reasonNote });
    const rule = await findStatusRule(tx, "DELETED");
    if (!rule) throw new AppError("INTERNAL_ERROR");
    const snapshot = toBookingView(booking);
    if ((await setStatus(tx, bookingId, "TRAINED", rule, actor.id)) !== 1) {
      throw new AppError("INVALID_STATUS_TRANSITION");
    }
    const now = new Date();
    await markHistoryDeleted(tx, bookingId, now, actor.id);
    await moveToTrash(
      tx,
      actor,
      {
        entityType: "booking",
        entityId: bookingId,
        branchId: booking.branchId,
        title: `${booking.customer.fullName} · ${booking.contract.contractCode}`,
        amount: null,
        snapshot: encode(bookingSchema, snapshot) as Record<string, unknown>,
      },
      reason,
      now,
    );
    const problem = await sessionProblem(tx, booking);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "booking",
      entityId: bookingId,
      action: "booking.history_deleted",
      before: { status: "TRAINED", consumes: booking.consumes, creditsPt: booking.creditsPt },
      after: { status: "DELETED", consumes: rule.consumes, creditsPt: rule.creditsPt },
      context: {
        contractId: booking.contractId,
        trainerId: booking.trainerId,
        trainedAt: booking.session?.completedAt?.toISOString() ?? null,
        remainingSessions: problem.remaining,
        reason: reasonNote,
      },
    });
    await emailSessionChange(tx, actor, booking, "refunded", problem.remaining);
  });
}

/**
 * Burn Show (D-028, BR-408): admin adds a trained session by hand, to restore one deleted by mistake or one that
 * took place without a booking. It follows the rules of a booking (the contract covers the day, the trainer and the
 * customer are free, the service allows the time) and of Đã tập (a session must be left), consumes and credits like
 * Đã tập, and is marked "added by hand" with its reason. It cannot be in the future (A-158).
 */
export async function burnShow(actor: Actor, rawInput: unknown): Promise<BookingView> {
  assertCan(actor, "session.burn");
  const data = parseInput(burnShowSchema, rawInput);
  const slot = toSlot(data);
  if (slot.scheduledStart.getTime() > Date.now()) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { date: ["futureDate"] } });
  }

  return withOverlapMapped(() =>
    prisma.$transaction(async (tx) => {
      if (!(await lockContract(tx, data.contractId))) throw new AppError("NOT_FOUND");
      const contract = await findContract(tx, data.contractId, contractsVisibleTo(actor));
      if (!contract) throw new AppError("NOT_FOUND");
      const reason = await resolveChoice(tx, "burnShowReasons", "reasonId", {
        optionId: data.reasonId,
        note: data.reasonNote,
      });
      await assertBookable(tx, contract, slot);
      const problem = await sessionProblem(tx, { contractId: contract.id, scheduledStart: slot.scheduledStart });
      if (problem.code) throw new AppError(problem.code);
      const rule = await findStatusRule(tx, "TRAINED");
      if (!rule) throw new AppError("INTERNAL_ERROR");

      const booking = await createTrainedBooking(tx, {
        ...slot,
        customerId: contract.customerId,
        contractId: contract.id,
        branchId: contract.branchId,
        rule,
        actorId: actor.id,
        reason,
      });
      await createSession(tx, {
        bookingId: booking.id,
        checkedInAt: slot.scheduledStart,
        checkedInById: actor.id,
        confirmationMethod: "MANUAL",
      });
      await recordCompletion(tx, booking.id, slot.scheduledEnd, actor.id, "MANUAL");
      const remaining = problem.remaining - 1;
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "booking",
        entityId: booking.id,
        action: "booking.burn_show",
        after: {
          status: "TRAINED",
          consumes: rule.consumes,
          creditsPt: rule.creditsPt,
          addedByHand: true,
          trainerId: slot.trainerId,
          scheduledStart: slot.scheduledStart.toISOString(),
          scheduledEnd: slot.scheduledEnd.toISOString(),
        },
        context: { contractId: contract.id, remainingSessions: remaining, reason: reason.note },
      });
      await emailSessionChange(tx, actor, booking, "added", remaining);
      return bookingView(tx, actor, booking.id);
    }, LOCKING_TRANSACTION),
  );
}

/** D-036: the customer is told of a change in their session count, once per session and kind, in the transaction. */
async function emailSessionChange(
  tx: Prisma.TransactionClient,
  actor: Actor,
  booking: Pick<BookingRecord, "id" | "customerId" | "scheduledStart" | "customer" | "contract">,
  kind: "refunded" | "added",
  remaining: number,
): Promise<void> {
  // The customer has no language of their own yet (OQ-051), so the email is in Vietnamese.
  const locale = "vi";
  const { subject, body } = sessionChangeEmail(locale, {
    kind,
    customerName: booking.customer.fullName,
    contractCode: booking.contract.contractCode,
    day: formatDay(sessionDay(booking.scheduledStart)),
    remaining,
  });
  await queueEmail(tx, {
    personId: booking.customerId,
    event: `session.${kind}`,
    dedupeKey: `session.${kind}:${booking.id}`,
    locale,
    subject,
    body,
    by: actor.id,
  });
}
