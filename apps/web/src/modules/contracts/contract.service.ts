import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { LOCKING_TRANSACTION, prisma, type Db } from "@/lib/db/prisma";
import { isUniqueViolation } from "@/lib/db/errors";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { assertCan } from "@/lib/permissions/assert";
import { parseInput } from "@/lib/validation/parse";
import type { Actor } from "@/lib/auth/session";
import { diffFields, recordAudit } from "@/modules/audit/audit.repository";
import { findCustomer } from "@/modules/customers/customer.repository";
import * as bookingRepo from "@/modules/bookings/booking.repository";
import { confirmedPaidByContract } from "@/modules/finance/payment.repository";
import * as repo from "@/modules/contracts/contract.repository";
import {
  canActivate,
  canCancel,
  contractFigures,
  effectiveStatus,
  isEditable,
  type ContractFigures,
  type EffectiveContractStatus,
  contractInputSchema,
  idempotencyKeySchema,
  listContractsSchema,
  type ContractData,
} from "@flow/shared/contracts";

const AUDITED_FIELDS = ["packageName", "contractValue", "totalSessions", "startDate", "endDate"] as const;

/** What the UI and API see: plain numbers and the effective status. */
export type ContractView = ContractFigures & {
  id: string;
  contractCode: string;
  customer: { id: string; customerCode: string; fullName: string };
  packageName: string;
  startDate: Date;
  endDate: Date;
  status: EffectiveContractStatus;
  createdAt: Date;
};

export type ContractPage = { items: ContractView[]; total: number; page: number; pageSize: number };

export async function listContracts(actor: Actor, rawQuery: unknown): Promise<ContractPage> {
  assertCan(actor, "contract.view");
  const query = parseInput(listContractsSchema, rawQuery);
  const today = gymToday();
  const { items, total } = await repo.listContracts(prisma, query, contractsVisibleTo(actor));
  return { items: await present(prisma, items, today), total, page: query.page, pageSize: query.pageSize };
}

export async function getContract(actor: Actor, id: string): Promise<ContractView> {
  assertCan(actor, "contract.view");
  return contractView(prisma, actor, id);
}

/** Contract views for `ids`, in that order (e.g. the debt list). */
export async function contractViewsByIds(actor: Actor, ids: string[]): Promise<ContractView[]> {
  assertCan(actor, "contract.view");
  const byId = new Map((await repo.findContracts(prisma, ids, contractsVisibleTo(actor))).map((c) => [c.id, c]));
  const ordered = ids.flatMap((id) => byId.get(id) ?? []);
  return present(prisma, ordered, gymToday());
}

/** The contract as `actor` sees it, read with `db` (e.g. inside a booking transaction). */
export async function contractView(db: Db, actor: Actor, id: string): Promise<ContractView> {
  return presentOne(db, await getOrThrow(db, actor, id), gymToday());
}

/**
 * Creates a DRAFT contract (T-015). A replay with the same key and the same content
 * returns the original contract; the same key with different content is rejected.
 */
export async function createContract(
  actor: Actor,
  customerId: string,
  input: unknown,
  idempotencyKey: unknown,
): Promise<{ contract: ContractView; replayed: boolean }> {
  assertCan(actor, "contract.manage");
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const data = parseInput(contractInputSchema, input);
  if (!z.uuid().safeParse(customerId).success || !(await findCustomer(prisma, customerId, {}))) {
    throw new AppError("NOT_FOUND");
  }

  const replay = await replayOf(key.data, customerId, data, actor);
  if (replay) return { contract: replay, replayed: true };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const contractCode = await repo.nextContractCode(tx);
      const contract = await repo.createContract(tx, {
        ...data,
        customerId,
        contractCode,
        idempotencyKey: key.data,
        createdById: actor.id,
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: contract.id,
        action: "contract.created",
        metadata: {
          contractCode,
          customerId,
          packageName: data.packageName,
          contractValue: data.contractValue,
          totalSessions: data.totalSessions,
        },
      });
      return contract;
    });
    return { contract: await presentOne(prisma, created, gymToday()), replayed: false };
  } catch (error) {
    // The same request submitted twice at once: the unique key lets one through.
    if (!isUniqueViolation(error)) throw error;
    const replayAfterRace = await replayOf(key.data, customerId, data, actor);
    if (replayAfterRace) return { contract: replayAfterRace, replayed: true };
    throw error;
  }
}

/** Drafts only, until OQ-015 decides what may change on an active contract. */
export async function updateContract(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.manage");
  const data = parseInput(contractInputSchema, input);
  const today = gymToday();

  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, actor, id);
    if (!isEditable(effectiveStatus(before, today))) throw new AppError("CONTRACT_NOT_EDITABLE");
    if ((await repo.updateDraft(tx, id, data)) === 0) throw new AppError("CONTRACT_NOT_EDITABLE");

    const after = await getOrThrow(tx, actor, id);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    if (Object.keys(changes).length > 0) {
      await recordAudit(tx, { actorUserId: actor.id, entityType: "contract", entityId: id, action: "contract.updated", metadata: { changes } });
    }
    return presentOne(tx, after, today);
  });
}

/** Repeating an activation that already happened returns the current state (docs/07). */
export async function activateContract(actor: Actor, id: string): Promise<ContractView> {
  assertCan(actor, "contract.manage");
  const today = gymToday();
  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, actor, id);
    if (before.status === "ACTIVE") return presentOne(tx, before, today);
    const from = effectiveStatus(before, today);
    if (!canActivate(from)) throw new AppError("INVALID_STATUS_TRANSITION");

    if ((await repo.moveStatus(tx, id, before.status, "ACTIVE")) === 0) {
      // Another request changed it first.
      const now = await getOrThrow(tx, actor, id);
      if (now.status === "ACTIVE") return presentOne(tx, now, today);
      throw new AppError("INVALID_STATUS_TRANSITION");
    }
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "contract",
      entityId: id,
      action: "contract.activated",
      metadata: { from, to: "ACTIVE" },
    });
    return presentOne(tx, await getOrThrow(tx, actor, id), today);
  });
}

/**
 * D-010, BR-017: cancels the contract and all of its BOOKED bookings in one
 * transaction, each audited. Refused while a booking is CHECKED_IN. The contract lock
 * keeps a check-in or a new booking from slipping in between the check and the
 * cancellation. Repeating the cancellation returns the current state.
 */
export async function cancelContract(actor: Actor, id: string): Promise<ContractView> {
  assertCan(actor, "contract.cancel");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const today = gymToday();

  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockContract(tx, id))) throw new AppError("NOT_FOUND");
    const before = await getOrThrow(tx, actor, id);
    if (before.status === "CANCELLED") return presentOne(tx, before, today);
    const from = effectiveStatus(before, today);
    if (!canCancel(from)) throw new AppError("INVALID_STATUS_TRANSITION");
    if ((await bookingRepo.countBookingsOfContract(tx, id, ["CHECKED_IN"])) > 0) {
      throw new AppError("CONTRACT_HAS_CHECKED_IN_BOOKING");
    }

    const cancelledBookingIds = await bookingRepo.cancelBookedBookingsOfContract(tx, id);
    for (const bookingId of cancelledBookingIds) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "booking",
        entityId: bookingId,
        action: "booking.cancelled",
        metadata: { from: "BOOKED", to: "CANCELLED", reason: "contract.cancelled", contractId: id },
      });
    }
    await repo.moveStatus(tx, id, before.status, "CANCELLED");
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "contract",
      entityId: id,
      action: "contract.cancelled",
      metadata: { from, to: "CANCELLED", cancelledBookings: cancelledBookingIds.length },
    });
    return presentOne(tx, await getOrThrow(tx, actor, id), today);
  }, LOCKING_TRANSACTION);
}

async function replayOf(key: string, customerId: string, data: ContractData, actor: Actor): Promise<ContractView | null> {
  const existing = await repo.findContractByIdempotencyKey(prisma, key);
  if (!existing) return null;
  const same =
    existing.customerId === customerId &&
    existing.createdById === actor.id &&
    existing.packageName === data.packageName &&
    Number(existing.contractValue) === data.contractValue &&
    existing.totalSessions === data.totalSessions &&
    existing.startDate.getTime() === data.startDate.getTime() &&
    existing.endDate.getTime() === data.endDate.getTime();
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return presentOne(prisma, existing, gymToday());
}

async function getOrThrow(db: Db, actor: Actor, id: string): Promise<repo.ContractRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const contract = await repo.findContract(db, id, contractsVisibleTo(actor));
  if (!contract) throw new AppError("NOT_FOUND");
  return contract;
}

/** Contract views with their confirmed payments (BR-013), read with `db`. */
async function present(db: Db, contracts: repo.ContractRecord[], today: Date): Promise<ContractView[]> {
  const paid = await confirmedPaidByContract(db, contracts.map((c) => c.id));
  return contracts.map((contract) => toView(contract, today, paid.get(contract.id) ?? 0));
}

async function presentOne(db: Db, contract: repo.ContractRecord, today: Date): Promise<ContractView> {
  const [view] = await present(db, [contract], today);
  return view;
}

function toView(contract: repo.ContractRecord, today: Date, confirmedPaidAmount: number): ContractView {
  return {
    id: contract.id,
    contractCode: contract.contractCode,
    customer: contract.customer,
    packageName: contract.packageName,
    startDate: contract.startDate,
    endDate: contract.endDate,
    status: effectiveStatus(contract, today),
    createdAt: contract.createdAt,
    ...contractFigures({
      totalSessions: contract.totalSessions,
      openingSessionsUsed: contract.openingSessionsUsed,
      completedSessions: contract._count.bookings,
      contractValue: Number(contract.contractValue),
      openingPaidAmount: Number(contract.openingPaidAmount),
      confirmedPaidAmount,
    }),
  };
}

function gymToday(): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE);
}

/** Trainers see only contracts of customers with a booking assigned to them (OQ-006 interim, docs/09). */
export function contractsVisibleTo(actor: Actor): Prisma.ContractWhereInput {
  if (actor.role === "TRAINER") return { customer: { bookings: { some: { trainer: { userId: actor.id } } } } };
  return {};
}
