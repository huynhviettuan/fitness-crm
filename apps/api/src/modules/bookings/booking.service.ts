import { z } from "zod";
import { customerRef } from "../customers/person.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isExclusionViolation, violatedConstraint } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { moveToTrash } from "../../platform/trash/trash.service.js";
import { encode } from "../../platform/http/encode.js";
import { deleteSchema } from "@flow/shared/trash";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as contractRepo from "../contracts/contract.repository.js";
import { effectiveStatus, entitledSessions } from "@flow/shared/contracts";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import { findBookableTrainer } from "../employees/employee.service.js";
import { isoWeekday, minutesOfTime } from "@flow/shared/employees";
import * as repo from "./booking.repository.js";
import {
  OPEN_BOOKING_STATUSES,
  bookingSchema,
  canCancelBooking,
  canDeleteBooking,
  canMarkNoShow,
  canReschedule,
  hasSessionForNewBooking,
  isWithinContractPeriod,
  type BookingFacts,
  type StatusColor,
  bookingInputSchema,
  dayBookingsSchema,
  listBookingsSchema,
  rescheduleSchema,
} from "@flow/shared/bookings";

/** At most this many bookings in one calendar day; far above one gym's capacity. */
const DAY_LIMIT = 1000;

/** What the UI and API see. */
export type BookingView = {
  id: string;
  status: string;
  /** The status as configured now: labels and color (D-025). */
  statusRule: { labelVi: string; labelEn: string; color: StatusColor; locksOnSet: boolean };
  /** The rule applied when the status was set (T-050). */
  consumes: boolean;
  creditsPt: boolean;
  holdsSlot: boolean;
  /** Burn Show: a trained session added by hand (D-028). */
  addedByHand: boolean;
  /** The customer checked in: a session record exists. */
  checkedIn: boolean;
  scheduledStart: Date;
  scheduledEnd: Date;
  createdAt: Date;
  customer: { id: string; customerCode: string; fullName: string };
  contract: { id: string; contractCode: string; packageName: string; remainingSessions: number; frozen: boolean };
  trainer: { id: string; employeeCode: string; fullName: string };
  /** Fulfillment facts, from check-in on (T-011). */
  session: {
    checkedInAt: Date;
    checkedInBy: string | null;
    completedAt: Date | null;
    completedBy: string | null;
    confirmationMethod: "MANUAL" | "DEVICE";
  } | null;
};

export type BookingPage = { items: BookingView[]; total: number; page: number; pageSize: number };

export async function listBookings(actor: Actor, rawQuery: unknown): Promise<BookingPage> {
  assertCan(actor, "booking.view");
  const query = parseInput(listBookingsSchema, rawQuery);
  const where: Prisma.BookingWhereInput = {
    AND: [
      bookingsVisibleTo(actor),
      {
        status: query.status,
        ...(query.checkedIn === undefined ? {} : { session: query.checkedIn ? { isNot: null } : { is: null } }),
        trainerId: query.trainerId,
        customerId: query.customerId,
        contractId: query.contractId,
        scheduledStart: {
          gte: query.from && startOfGymDay(query.from),
          lt: query.to && startOfGymDay(nextDay(query.to)),
        },
      },
    ],
  };
  const { items, total } = await repo.listBookings(prisma, where, {
    order: query.order,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: items.map(toBookingView), total, page: query.page, pageSize: query.pageSize };
}

/** Every booking starting on one gym day, in any status, for the PT calendar. */
export async function listDayBookings(actor: Actor, rawQuery: unknown): Promise<BookingView[]> {
  assertCan(actor, "booking.view");
  const { date, days, trainerId, customerId, branchId } = parseInput(dayBookingsSchema, rawQuery);
  const where: Prisma.BookingWhereInput = {
    AND: [
      bookingsVisibleTo(actor),
      {
        trainerId,
        customerId,
        branchId,
        scheduledStart: { gte: startOfGymDay(date), lt: startOfGymDay(nextDay(date, days)) },
      },
    ],
  };
  const { items } = await repo.listBookings(prisma, where, { order: "asc", skip: 0, take: DAY_LIMIT });
  return items.map(toBookingView);
}

export async function getBooking(actor: Actor, id: string): Promise<BookingView> {
  assertCan(actor, "booking.view");
  return bookingView(prisma, actor, id);
}

/**
 * Creates a BOOKED booking. Booking never consumes a session (BR-004). Runs under the
 * contract lock, so two bookings for the same contract cannot both take its last free
 * session (OQ-008 interim); two overlapping bookings for the same trainer are refused
 * by the database even when they arrive together (T-014).
 */
export async function createBooking(actor: Actor, input: unknown): Promise<BookingView> {
  assertCan(actor, "booking.manage");
  const data = parseInput(bookingInputSchema, input);
  assertOwnTrainer(actor, data.trainerId);
  const slot = toSlot(data);

  return withOverlapMapped(() =>
    prisma.$transaction(async (tx) => {
      if (!(await contractRepo.lockContract(tx, data.contractId))) throw new AppError("NOT_FOUND");
      const contract = await contractRepo.findContract(tx, data.contractId, contractsVisibleTo(actor));
      if (!contract) throw new AppError("NOT_FOUND");
      // OQ-010 interim: the customer must own the contract.
      if (contract.customerId !== data.customerId) throw new AppError("BOOKING_CUSTOMER_CONTRACT_MISMATCH");
      await assertBookable(tx, contract, slot);

      const remaining =
        entitledSessions(contract.totalSessions, contract.bonusSessions) -
        contract.openingSessionsUsed -
        contractRepo.usedSessionsOf(contract);
      const open = await repo.countBookingsOfContract(tx, contract.id, OPEN_BOOKING_STATUSES);
      if (!hasSessionForNewBooking(remaining, open)) throw new AppError("CONTRACT_NO_REMAINING_SESSIONS");

      // A booking belongs to its contract's branch (D-014).
      const booking = await repo.createBooking(tx, {
        ...slot,
        customerId: data.customerId,
        contractId: data.contractId,
        branchId: contract.branchId,
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "booking",
        entityId: booking.id,
        action: "booking.created",
        after: {
          contractId: contract.id,
          trainerId: slot.trainerId,
          scheduledStart: slot.scheduledStart.toISOString(),
          scheduledEnd: slot.scheduledEnd.toISOString(),
        },
      });
      return toBookingView(booking);
    }, LOCKING_TRANSACTION),
  );
}

/** A-006: BOOKED only. Changes trainer and time; re-validates like a new booking. */
export async function rescheduleBooking(actor: Actor, id: string, input: unknown): Promise<BookingView> {
  assertCan(actor, "booking.manage");
  const data = parseInput(rescheduleSchema, input);
  assertOwnTrainer(actor, data.trainerId);
  const slot = toSlot(data);

  return withOverlapMapped(() =>
    changeLockedBooking(actor, id, async (tx, before) => {
      if (!canReschedule(factsOf(before))) throw new AppError("INVALID_STATUS_TRANSITION");
      const contract = await contractRepo.findContract(tx, before.contractId, {});
      if (!contract) throw new AppError("NOT_FOUND");
      await assertBookable(tx, contract, slot, id);

      if ((await repo.rescheduleBooked(tx, id, slot)) === 0) throw new AppError("INVALID_STATUS_TRANSITION");
      const after = await bookingView(tx, actor, id);
      const changes = diffFields(
        { trainerId: before.trainerId, scheduledStart: before.scheduledStart, scheduledEnd: before.scheduledEnd },
        { trainerId: after.trainer.id, scheduledStart: after.scheduledStart, scheduledEnd: after.scheduledEnd },
        ["trainerId", "scheduledStart", "scheduledEnd"],
      );
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "booking",
          entityId: id,
          action: "booking.rescheduled",
          ...changes,
        });
      }
      return after;
    }),
  );
}

/**
 * Hủy lịch: a Booked session, also a checked-in one as the exceptional cancel (A-006). It does not consume (D-025).
 * When the cut-off parameter is on, a cancellation closer to the start than that many hours is refused (BR-410).
 */
export async function cancelBooking(actor: Actor, id: string): Promise<BookingView> {
  assertCan(actor, "booking.manage");
  const cutoffHours = Number(await readParameter(prisma, "cancelCutoffHours"));
  return transitionBooking(actor, id, {
    to: "CANCELLED",
    allowed: canCancelBooking,
    action: "booking.cancelled",
    check: (booking) => {
      if (cutoffHours > 0 && booking.scheduledStart.getTime() - Date.now() < cutoffHours * 3_600_000) {
        throw new AppError("BOOKING_CANCEL_TOO_LATE");
      }
    },
  });
}

/**
 * Xóa (M5.3, D-025): a session booked by mistake. Only a Booked session the customer has not checked in to; it goes to
 * the trash with a reason, frees the time, and uses nothing. Đã tập is corrected by the check-in history, not here.
 */
export async function deleteBooking(actor: Actor, id: string, input: unknown): Promise<void> {
  assertCan(actor, "booking.delete");
  const { reasonId, reasonNote } = parseInput(deleteSchema, input);
  await changeLockedBooking(actor, id, async (tx, booking) => {
    if (!canDeleteBooking(factsOf(booking))) throw new AppError("INVALID_STATUS_TRANSITION");
    const reason = await resolveChoice(tx, "deleteReasons", "reasonId", { optionId: reasonId, note: reasonNote });
    const rule = await repo.findStatusRule(tx, "DELETED");
    if (!rule) throw new AppError("INTERNAL_ERROR");
    const snapshot = toBookingView(booking);
    if ((await repo.setStatus(tx, id, "BOOKED", rule, actor.id)) !== 1) throw new AppError("INVALID_STATUS_TRANSITION");
    await moveToTrash(
      tx,
      actor,
      {
        entityType: "booking",
        entityId: id,
        branchId: booking.branchId,
        title: `${booking.customer.fullName} · ${booking.contract.contractCode}`,
        amount: null,
        snapshot: encode(bookingSchema, snapshot) as Record<string, unknown>,
      },
      reason,
      new Date(),
    );
  });
}

/** Khách không đến: a Booked session not yet checked in (A-006). Consumes and credits the PT by its rule (D-025). */
export async function markNoShow(actor: Actor, id: string): Promise<BookingView> {
  assertCan(actor, "booking.manage");
  return transitionBooking(actor, id, { to: "NO_SHOW", allowed: canMarkNoShow, action: "booking.no_show" });
}

/**
 * Moves a booking to `to` if `allowed` permits it, under the booking lock. Repeating
 * a transition that already happened returns the current state (docs/07). `apply`
 * runs extra writes in the same transaction, e.g. the session record at check-in.
 */
export async function transitionBooking(
  actor: Actor,
  id: string,
  options: {
    to: string;
    allowed: (facts: BookingFacts) => boolean;
    action: string;
    /** Extra refusals, run before anything changes. */
    check?: (booking: repo.BookingRecord) => void;
    apply?: (tx: Prisma.TransactionClient) => Promise<unknown>;
  },
): Promise<BookingView> {
  return changeLockedBooking(actor, id, async (tx, before) => {
    if (before.status === options.to) return toBookingView(before);
    // A status that locks once set (Đã tập) is never left (D-026).
    if (before.statusRule.locksOnSet || !options.allowed(factsOf(before))) {
      throw new AppError("INVALID_STATUS_TRANSITION");
    }
    options.check?.(before);
    const rule = await repo.findStatusRule(tx, options.to);
    if (!rule) throw new AppError("INTERNAL_ERROR");
    // Cancelling stays possible, so admin can deal with the bookings of a deactivated contract (D-023).
    if (options.to !== "CANCELLED" && before.contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if ((await repo.setStatus(tx, id, before.status, rule, actor.id)) === 0)
      throw new AppError("INVALID_STATUS_TRANSITION");
    await options.apply?.(tx);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "booking",
      entityId: id,
      action: options.action,
      before: { status: before.status },
      after: { status: options.to, consumes: rule.consumes, creditsPt: rule.creditsPt },
      context: { contractId: before.contractId },
    });
    return bookingView(tx, actor, id);
  });
}

/**
 * Runs `change` in a transaction that holds the booking's contract and booking locks
 * (T-013 lock order). A booking the actor cannot see is NOT_FOUND, which is how a
 * trainer is kept to their own bookings (A-007).
 */
export async function changeLockedBooking<T>(
  actor: Actor,
  id: string,
  change: (tx: Prisma.TransactionClient, booking: repo.BookingRecord) => Promise<T>,
): Promise<T> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockBooking(tx, id))) throw new AppError("NOT_FOUND");
    const booking = await repo.findBooking(tx, id, bookingsVisibleTo(actor));
    if (!booking) throw new AppError("NOT_FOUND");
    return change(tx, booking);
  }, LOCKING_TRANSACTION);
}

export async function bookingView(db: Db, actor: Actor, id: string): Promise<BookingView> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const booking = await repo.findBooking(db, id, bookingsVisibleTo(actor));
  if (!booking) throw new AppError("NOT_FOUND");
  return toBookingView(booking);
}

/**
 * Which bookings an actor may see: their branches, and with "own" schedule scope only
 * their own sessions as PT and the bookings of customers they created (D-017, A-029).
 */
export function bookingsVisibleTo(actor: Actor): Prisma.BookingWhereInput {
  const own: Prisma.BookingWhereInput = {
    OR: [...(actor.employeeId ? [{ trainerId: actor.employeeId }] : []), { customer: { createdById: actor.id } }],
  };
  // A deleted session (Xóa) is in the trash, not in any list.
  return { AND: [inBranches(actor), { status: { not: "DELETED" } }, isOwnOnly(actor, "schedule") ? own : {}] };
}

/** The gym day a booking falls on (A-001). */
export function sessionDay(scheduledStart: Date): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE, scheduledStart);
}

/**
 * BR-003, BR-012, BR-403, D-030, D-058: the contract is active and covers the day, the trainer teaches PT and
 * still works here, the service allows the time, and neither the trainer nor the customer is busy. A shift
 * is never a limit (D-058).
 */
export async function assertBookable(
  tx: Prisma.TransactionClient,
  contract: contractRepo.ContractRecord,
  slot: repo.BookingSlot,
  excludeBookingId?: string,
): Promise<void> {
  if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
  if (effectiveStatus(contract, gymToday()) !== "ACTIVE") throw new AppError("CONTRACT_NOT_ACTIVE");
  if (!isWithinContractPeriod(sessionDay(slot.scheduledStart), contract)) {
    throw new AppError("BOOKING_OUTSIDE_CONTRACT_PERIOD");
  }
  if (!(await findBookableTrainer(tx, slot.trainerId))) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { trainerId: ["trainerUnavailable"] } });
  }
  await assertServiceAllows(tx, contract, slot, excludeBookingId);
  if (await repo.findOverlappingBooking(tx, slot, excludeBookingId)) throw new AppError("BOOKING_TRAINER_OVERLAP");
  if (await repo.findOverlappingCustomerBooking(tx, contract.customerId, slot, excludeBookingId)) {
    throw new AppError("BOOKING_CUSTOMER_OVERLAP");
  }
}

/**
 * A-149: the service's hours of the day and its daily and weekly limits per customer. A limit counts the customer's
 * sessions on the same service that hold their time; the week runs Monday to Sunday of the gym calendar.
 */
async function assertServiceAllows(
  tx: Prisma.TransactionClient,
  contract: contractRepo.ContractRecord,
  slot: repo.BookingSlot,
  excludeBookingId?: string,
): Promise<void> {
  const { service } = contract;
  // A contract imported without a service has no hours or limits to apply.
  if (!service) return;
  const day = sessionDay(slot.scheduledStart);
  if (service.allowedFrom && service.allowedTo) {
    const midnight = startOfGymDay(day).getTime();
    const from = (slot.scheduledStart.getTime() - midnight) / 60_000;
    const to = (slot.scheduledEnd.getTime() - midnight) / 60_000;
    if (from < minutesOfTime(service.allowedFrom) || to > minutesOfTime(service.allowedTo)) {
      throw new AppError("BOOKING_OUTSIDE_SERVICE_HOURS");
    }
  }
  const count = (from: Date, days: number) =>
    repo.countServiceBookings(tx, {
      customerId: contract.customerId,
      serviceId: service.id,
      from: startOfGymDay(from),
      to: startOfGymDay(nextDay(from, days)),
      excludeId: excludeBookingId,
    });
  if (service.maxPerDay !== null && (await count(day, 1)) >= service.maxPerDay) {
    throw new AppError("BOOKING_SERVICE_DAILY_LIMIT");
  }
  if (service.maxPerWeek !== null) {
    const monday = nextDay(day, 1 - isoWeekday(day));
    if ((await count(monday, 7)) >= service.maxPerWeek) throw new AppError("BOOKING_SERVICE_WEEKLY_LIMIT");
  }
}

/**
 * With "own" schedule scope (the PT role), a user books only as the trainer: the employee
 * their login belongs to, and it must belong to one (D-017, brief §8.4).
 */
function assertOwnTrainer(actor: Actor, trainerId: string): void {
  if (!isOwnOnly(actor, "schedule")) return;
  if (!actor.employeeId) throw forbidden(actor, "booking.manage", "login not linked to an employee");
  if (actor.employeeId !== trainerId) throw forbidden(actor, "booking.manage", "booking for another trainer");
}

/** Two overlapping bookings that passed the pre-check together: the constraint decides (T-014). */
export async function withOverlapMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw new AppError(
        violatedConstraint(error) === "booking_customer_no_overlap"
          ? "BOOKING_CUSTOMER_OVERLAP"
          : "BOOKING_TRAINER_OVERLAP",
      );
    }
    throw error;
  }
}

export function toSlot(data: { trainerId: string; date: Date; startTime: string; endTime: string }): repo.BookingSlot {
  return {
    trainerId: data.trainerId,
    scheduledStart: instantAt(data.date, data.startTime, env.GYM_TIMEZONE),
    scheduledEnd: instantAt(data.date, data.endTime, env.GYM_TIMEZONE),
  };
}

/** What decides the actions on a booking (D-025): its status and whether the customer checked in. */
export function factsOf(booking: repo.BookingRecord): BookingFacts {
  return { status: booking.status, checkedIn: booking.session !== null };
}

export function toBookingView(booking: repo.BookingRecord): BookingView {
  const { contract, session } = booking;
  return {
    id: booking.id,
    status: booking.status,
    statusRule: { ...booking.statusRule, color: booking.statusRule.color as StatusColor },
    consumes: booking.consumes,
    creditsPt: booking.creditsPt,
    holdsSlot: booking.holdsSlot,
    addedByHand: booking.addedByHand,
    checkedIn: session !== null,
    scheduledStart: booking.scheduledStart,
    scheduledEnd: booking.scheduledEnd,
    createdAt: booking.createdAt,
    customer: customerRef(booking.customer),
    contract: {
      id: contract.id,
      contractCode: contract.contractCode,
      packageName: contract.packageName,
      remainingSessions:
        entitledSessions(contract.totalSessions, contract.bonusSessions) -
        contract.openingSessionsUsed -
        contractRepo.usedSessionsOf(contract),
      frozen: contract.status === "FROZEN",
    },
    trainer: booking.trainer,
    session: session && {
      checkedInAt: session.checkedInAt,
      checkedInBy: session.checkedInBy?.name ?? null,
      completedAt: session.completedAt,
      completedBy: session.completedBy?.name ?? null,
      confirmationMethod: session.confirmationMethod as "MANUAL" | "DEVICE",
    },
  };
}

export function startOfGymDay(day: Date): Date {
  return instantAt(day, "00:00", env.GYM_TIMEZONE);
}

function nextDay(day: Date, days = 1): Date {
  return new Date(day.getTime() + days * 24 * 60 * 60 * 1000);
}

function gymToday(): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE);
}
