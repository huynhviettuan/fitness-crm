import { z } from "zod";
import { customerRef } from "../customers/person.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isExclusionViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone, instantAt } from "@flow/shared/validation";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as contractRepo from "../contracts/contract.repository.js";
import { effectiveStatus } from "@flow/shared/contracts";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import { assertWithinWorkingHours, findBookableTrainer } from "../employees/employee.service.js";
import * as repo from "./booking.repository.js";
import {
  OPEN_BOOKING_STATUSES,
  canCancelBooking,
  canMarkNoShow,
  canReschedule,
  hasSessionForNewBooking,
  isWithinContractPeriod,
  type BookingStatus,
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
  status: BookingStatus;
  scheduledStart: Date;
  scheduledEnd: Date;
  createdAt: Date;
  customer: { id: string; customerCode: string; fullName: string };
  contract: { id: string; contractCode: string; packageName: string; remainingSessions: number };
  trainer: { id: string; employeeCode: string; fullName: string };
  /** Fulfillment facts, from check-in on (T-011). */
  session: { checkedInAt: Date; checkedInBy: string; completedAt: Date | null; completedBy: string | null } | null;
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
  const { date, trainerId } = parseInput(dayBookingsSchema, rawQuery);
  const where: Prisma.BookingWhereInput = {
    AND: [
      bookingsVisibleTo(actor),
      { trainerId, scheduledStart: { gte: startOfGymDay(date), lt: startOfGymDay(nextDay(date)) } },
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

      const remaining = contract.totalSessions - contract.openingSessionsUsed - contract._count.bookings;
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
      if (!canReschedule(before.status)) throw new AppError("INVALID_STATUS_TRANSITION");
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
        await recordAudit(tx, { actorUserId: actor.id, entityType: "booking", entityId: id, action: "booking.rescheduled", ...changes });
      }
      return after;
    }),
  );
}

/** BOOKED, or CHECKED_IN as the exceptional cancel (A-006). Does not consume (BR-008). */
export async function cancelBooking(actor: Actor, id: string): Promise<BookingView> {
  assertCan(actor, "booking.manage");
  return transitionBooking(actor, id, { to: "CANCELLED", allowed: canCancelBooking, action: "booking.cancelled" });
}

/** BOOKED only (A-006). Does not consume in V1 (BR-008). */
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
    to: BookingStatus;
    allowed: (status: BookingStatus) => boolean;
    action: string;
    apply?: (tx: Prisma.TransactionClient) => Promise<unknown>;
  },
): Promise<BookingView> {
  return changeLockedBooking(actor, id, async (tx, before) => {
    if (before.status === options.to) return toBookingView(before);
    if (!options.allowed(before.status)) throw new AppError("INVALID_STATUS_TRANSITION");
    if ((await repo.moveStatus(tx, id, before.status, options.to)) === 0) throw new AppError("INVALID_STATUS_TRANSITION");
    await options.apply?.(tx);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "booking",
      entityId: id,
      action: options.action,
      before: { status: before.status },
      after: { status: options.to },
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
  return { AND: [inBranches(actor), isOwnOnly(actor, "schedule") ? own : {}] };
}

/** The gym day a booking falls on (A-001). */
export function sessionDay(scheduledStart: Date): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE, scheduledStart);
}

/**
 * BR-003, BR-012, BR-010, D-030: the contract is active and covers the day, the trainer
 * teaches PT and still works here, the slot is inside their working hours, and they are free.
 */
async function assertBookable(
  tx: Prisma.TransactionClient,
  contract: contractRepo.ContractRecord,
  slot: repo.BookingSlot,
  excludeBookingId?: string,
): Promise<void> {
  if (effectiveStatus(contract, gymToday()) !== "ACTIVE") throw new AppError("CONTRACT_NOT_ACTIVE");
  if (!isWithinContractPeriod(sessionDay(slot.scheduledStart), contract)) {
    throw new AppError("BOOKING_OUTSIDE_CONTRACT_PERIOD");
  }
  if (!(await findBookableTrainer(tx, slot.trainerId))) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { trainerId: ["trainerUnavailable"] } });
  }
  await assertWithinWorkingHours(tx, slot.trainerId, slot.scheduledStart, slot.scheduledEnd);
  if (await repo.findOverlappingBooking(tx, slot, excludeBookingId)) throw new AppError("BOOKING_TRAINER_OVERLAP");
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
async function withOverlapMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isExclusionViolation(error)) throw new AppError("BOOKING_TRAINER_OVERLAP");
    throw error;
  }
}

function toSlot(data: { trainerId: string; date: Date; startTime: string; endTime: string }): repo.BookingSlot {
  return {
    trainerId: data.trainerId,
    scheduledStart: instantAt(data.date, data.startTime, env.GYM_TIMEZONE),
    scheduledEnd: instantAt(data.date, data.endTime, env.GYM_TIMEZONE),
  };
}

export function toBookingView(booking: repo.BookingRecord): BookingView {
  const { contract, session } = booking;
  return {
    id: booking.id,
    status: booking.status,
    scheduledStart: booking.scheduledStart,
    scheduledEnd: booking.scheduledEnd,
    createdAt: booking.createdAt,
    customer: customerRef(booking.customer),
    contract: {
      id: contract.id,
      contractCode: contract.contractCode,
      packageName: contract.packageName,
      remainingSessions: contract.totalSessions - contract.openingSessionsUsed - contract._count.bookings,
    },
    trainer: booking.trainer,
    session: session && {
      checkedInAt: session.checkedInAt,
      checkedInBy: session.checkedInBy.name,
      completedAt: session.completedAt,
      completedBy: session.completedBy?.name ?? null,
    },
  };
}

function startOfGymDay(day: Date): Date {
  return instantAt(day, "00:00", env.GYM_TIMEZONE);
}

function nextDay(day: Date): Date {
  return new Date(day.getTime() + 24 * 60 * 60 * 1000);
}

function gymToday(): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE);
}
