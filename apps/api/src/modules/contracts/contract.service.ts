import { z } from "zod";
import { customerRef } from "../customers/person.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { findCustomer } from "../customers/customer.repository.js";
import { ownCustomers, visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { validPaidByContract } from "../finance/payment.repository.js";
import * as repo from "./contract.repository.js";
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
  assertCan(actor, "contract.create");
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const data = parseInput(contractInputSchema, input);
  // Only for a customer the actor can see; the contract belongs to the customer's branch (D-014).
  const customer = z.uuid().safeParse(customerId).success
    ? await findCustomer(prisma, customerId, customersVisibleTo(actor))
    : null;
  if (!customer) throw new AppError("NOT_FOUND");

  const replay = await replayOf(key.data, customerId, data, actor);
  if (replay) return { contract: replay, replayed: true };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const contractCode = await repo.nextContractCode(tx);
      const contract = await repo.createContract(tx, {
        ...data,
        customerId,
        branchId: customer.branchId,
        contractCode,
        idempotencyKey: key.data,
        createdById: actor.id,
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: contract.id,
        action: "contract.created",
        after: {
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
  assertCan(actor, "contract.create");
  const data = parseInput(contractInputSchema, input);
  const today = gymToday();

  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, actor, id);
    if (!isEditable(effectiveStatus(before, today))) throw new AppError("CONTRACT_NOT_EDITABLE");
    if ((await repo.updateDraft(tx, id, data)) === 0) throw new AppError("CONTRACT_NOT_EDITABLE");

    const after = await getOrThrow(tx, actor, id);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    if (changes) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: id,
        action: "contract.updated",
        ...changes,
      });
    }
    return presentOne(tx, after, today);
  });
}

/** Repeating an activation that already happened returns the current state (docs/07). */
export async function activateContract(actor: Actor, id: string): Promise<ContractView> {
  assertCan(actor, "contract.approve");
  const today = gymToday();
  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, actor, id);
    if (before.status === "ACTIVE") return presentOne(tx, before, today);
    const from = effectiveStatus(before, today);
    if (!canActivate(from)) throw new AppError("INVALID_STATUS_TRANSITION");
    // Activating is the contract's approval until M4: never by its creator (D-018).
    if (before.createdById === actor.id) throw new AppError("APPROVAL_OWN_REQUEST");

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
      before: { status: from },
      after: { status: "ACTIVE" },
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
        before: { status: "BOOKED" },
        after: { status: "CANCELLED" },
        context: { reason: "contract.cancelled", contractId: id },
      });
    }
    await repo.moveStatus(tx, id, before.status, "CANCELLED");
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "contract",
      entityId: id,
      action: "contract.cancelled",
      before: { status: from },
      after: { status: "CANCELLED" },
      context: { cancelledBookings: cancelledBookingIds.length },
    });
    return presentOne(tx, await getOrThrow(tx, actor, id), today);
  }, LOCKING_TRANSACTION);
}

async function replayOf(
  key: string,
  customerId: string,
  data: ContractData,
  actor: Actor,
): Promise<ContractView | null> {
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
  const paid = await validPaidByContract(
    db,
    contracts.map((c) => c.id),
  );
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
    customer: customerRef(contract.customer),
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

/**
 * Which contracts an actor may see: their branches, and with "own" scope the contracts
 * they created or of the customers they are responsible for (D-017, A-029).
 */
export function contractsVisibleTo(actor: Actor): Prisma.ContractWhereInput {
  const own: Prisma.ContractWhereInput = { OR: [{ createdById: actor.id }, { customer: ownCustomers(actor) }] };
  return { AND: [inBranches(actor), isOwnOnly(actor, "contracts") ? own : {}] };
}
