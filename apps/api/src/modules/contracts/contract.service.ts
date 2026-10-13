import { createHash } from "node:crypto";
import { z } from "zod";
import { customerRef } from "../customers/person.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import {
  cancelPendingFor,
  ruleFor,
  submitForApproval,
  withPendingConflictMapped,
} from "../../platform/approvals/approval.engine.js";
import { encode } from "../../platform/http/encode.js";
import { moveToTrash } from "../../platform/trash/trash.service.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen, chosenSelect, resolveChoice } from "../../platform/options/option.service.js";
import { ownCustomers, visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import { findCustomer } from "../customers/customer.repository.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { addStatusChange } from "../leads/lead.repository.js";
import { recordPaymentIn } from "../finance/payment.service.js";
import { validPaidByContract } from "../finance/payment.repository.js";
import { canApproveDiscount, discountOfOffer, resolveOffers } from "../promotions/promotion.service.js";
import { onSaleIn, priceAt } from "../services/service.service.js";
import * as repo from "./contract.repository.js";
import {
  canCancel,
  canUnapprove,
  contractEndDate,
  contractFigures,
  contractInputSchema,
  contractNoteSchema,
  contractSchema,
  contractStaffQuerySchema,
  effectiveStatus,
  entitledSessions,
  idempotencyKeySchema,
  isEditable,
  listContractsSchema,
  paymentStatusOf,
  ptSharesRequired,
  sharesProblems,
  unapproveSchema,
  type Contract as ContractView,
  type ContractStaff,
  type ContractData,
  type Share,
} from "@flow/shared/contracts";
import type { AuditEvent } from "@flow/shared/audit";
import { displayNameOf } from "@flow/shared/services";
import { deleteSchema } from "@flow/shared/trash";
import { discountPercentOf, priceBreakdown } from "@flow/shared/promotions";

const AUDITED_FIELDS = [
  "packageName",
  "serviceId",
  "contractType",
  "contractValue",
  "totalSessions",
  "bonusSessions",
  "approvedUnitPrice",
  "isExceptionPrice",
  "contractDate",
  "startDate",
  "endDate",
] as const;

export type { ContractView };
export type ContractPage = {
  items: ContractView[];
  total: number;
  page: number;
  pageSize: number;
  /** Value, paid, and debt over everything the filters match; null when receipt totals are hidden (D-017). */
  totals: { contractValue: number; paidAmount: number; debt: number } | null;
};

export async function listContracts(actor: Actor, rawQuery: unknown): Promise<ContractPage> {
  assertCan(actor, "contract.view");
  const { page, pageSize, paymentStatus, ...filters } = parseInput(listContractsSchema, rawQuery);
  const today = gymToday();
  let where: Prisma.ContractWhereInput = {
    AND: [contractsVisibleTo(actor), repo.filterWhere(filters, today)],
  };
  // The payment status is derived from valid receipts (BR-013), so the matching contracts are found first.
  const money = await repo.moneyOf(prisma, where);
  const paid = await validPaidByContract(
    prisma,
    money.map((row) => row.id),
  );
  const paidOf = (row: (typeof money)[number]) => Number(row.openingPaidAmount) + (paid.get(row.id) ?? 0);
  const matching = paymentStatus
    ? money.filter((row) => paymentStatusOf(Number(row.contractValue), paidOf(row)) === paymentStatus)
    : money;
  if (paymentStatus) where = { AND: [where, { id: { in: matching.map((row) => row.id) } }] };

  const { items, total } = await repo.listContracts(prisma, where, { page, pageSize });
  const contractValue = matching.reduce((sum, row) => sum + Number(row.contractValue), 0);
  const paidAmount = matching.reduce((sum, row) => sum + paidOf(row), 0);
  return {
    items: await present(prisma, items, today, actor),
    total,
    page,
    pageSize,
    totals: isMasked(actor, "receipts.totals") ? null : { contractValue, paidAmount, debt: contractValue - paidAmount },
  };
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
  return present(prisma, ordered, gymToday(), actor);
}

/** The contract as `actor` sees it, read with `db` (e.g. inside a booking transaction). */
export async function contractView(db: Db, actor: Actor, id: string): Promise<ContractView> {
  return presentOne(db, await getOrThrow(db, actor, id), gymToday(), actor);
}

/**
 * Creates a DRAFT contract (T-015). The unit price, total, end date, and name are computed from the service's tier at
 * the contract date (BR-301); a price of the creator's own is an exception price with a reason (BR-302). A replay with
 * the same key and the same content returns the original contract; the same key with different content is rejected.
 * A first payment is saved with the contract, or not at all.
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
  if (data.firstPayment) assertCan(actor, "payment.record");
  // Only for a customer the actor can see; the contract belongs to the customer's branch (D-014).
  const customer = z.uuid().safeParse(customerId).success
    ? await findCustomer(prisma, customerId, customersVisibleTo(actor))
    : null;
  if (!customer) throw new AppError("NOT_FOUND");

  const fingerprint = fingerprintOf(customerId, actor, data);
  const replay = await replayOf(key.data, customerId, fingerprint, actor);
  if (replay) return { contract: replay, replayed: true };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const built = await build(tx, actor, { id: customer.id, branchId: customer.branchId }, data);
      const contractCode = await repo.nextContractCode(tx);
      const contract = await repo.createContract(
        tx,
        {
          ...built.write,
          customerId,
          branchId: customer.branchId,
          contractCode,
          idempotencyKey: key.data,
          requestFingerprint: fingerprint,
          createdById: actor.id,
        },
        built.shares,
        built.companionIds,
      );
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: contract.id,
        action: "contract.created",
        after: {
          contractCode,
          customerId,
          packageName: built.write.packageName,
          serviceId: built.write.serviceId ?? null,
          contractValue: built.write.contractValue,
          totalSessions: built.write.totalSessions,
          bonusSessions: built.write.bonusSessions ?? 0,
          tierUnitPrice: built.write.tierUnitPrice ?? null,
          approvedUnitPrice: built.write.approvedUnitPrice,
          isExceptionPrice: built.write.isExceptionPrice ?? false,
          promotionId: built.write.promotionId ?? null,
          voucherId: built.write.voucherId ?? null,
          shares: built.shares,
          companionIds: built.companionIds,
        },
      });
      if (data.firstPayment) {
        // The receipt is dated today; a future day is not a payment yet (BR-014).
        await recordPaymentIn(
          tx,
          actor,
          contract.id,
          { ...data.firstPayment, paidOn: gymToday() },
          keyDerivedFrom(key.data, "first-payment"),
        );
      }
      // A-120: the contract waits for an approver, or is approved at once when the matrix asks for none.
      if ((await ruleFor(tx, "contract.create")).required) {
        await submitForApproval(tx, actor, {
          action: "contract.create",
          entityType: "contract",
          entityId: contract.id,
          branchId: customer.branchId,
          title: titleOf(contractCode, customer.fullName),
          amount: built.write.contractValue as number,
          payload: { contractCode },
        });
      } else {
        await decideContract(tx, actor, contract.id, "APPROVED");
      }
      return contract.id;
    }, LOCKING_TRANSACTION);
    return {
      contract: await presentOne(prisma, await getOrThrow(prisma, actor, created), gymToday(), actor),
      replayed: false,
    };
  } catch (error) {
    // The same request submitted twice at once: the unique key lets one through.
    if (!isUniqueViolation(error)) throw error;
    const replayAfterRace = await replayOf(key.data, customerId, fingerprint, actor);
    if (replayAfterRace) return { contract: replayAfterRace, replayed: true };
    throw error;
  }
}

/** Drafts only, until OQ-015 decides what may change on an active contract. The price is worked out again. */
export async function updateContract(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.create");
  const data = parseInput(contractInputSchema, input);
  if (data.firstPayment) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { firstPayment: ["onlyOnCreate"] } });
  }
  const today = gymToday();

  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, actor, id);
    if (!isEditable(effectiveStatus(before, today))) throw new AppError("CONTRACT_NOT_EDITABLE");
    const built = await build(tx, actor, { id: before.customerId, branchId: before.branchId }, data);
    const fingerprint = fingerprintOf(before.customerId, actor, data);
    const changed = await repo.updateDraft(
      tx,
      id,
      { ...built.write, requestFingerprint: fingerprint },
      built.shares,
      built.companionIds,
    );
    if (changed === 0) throw new AppError("CONTRACT_NOT_EDITABLE");
    // The approver sees the value as edited (A-120).
    await tx.approvalRequest.updateMany({
      where: { actionType: "contract.create", entityId: id, status: "PENDING" },
      data: { amount: built.write.contractValue as number },
    });

    const after = await getOrThrow(tx, actor, id);
    const changes = diffFields(before, after, AUDITED_FIELDS);
    const shareChange = sharesKey(before.shares) !== sharesKey(after.shares);
    if (changes || shareChange) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: id,
        action: "contract.updated",
        before: { ...changes?.before, ...(shareChange ? { shares: sharesKey(before.shares) } : {}) },
        after: { ...changes?.after, ...(shareChange ? { shares: sharesKey(after.shares) } : {}) },
      });
    }
    return presentOne(tx, after, today, actor);
  });
}

/**
 * Approving or rejecting a pending contract (D-018, A-121), called by the approval engine's handler in the decision's
 * transaction, which has taken the contract lock. Approving checks that the approver's role may approve the discount
 * (A-112), records who and when, and turns the customer's lead status to "Đã ký hợp đồng" (A-123). Rejecting moves it
 * to REJECTED, where it has no effect.
 */
export async function decideContract(tx: Db, decider: Actor, id: string, to: "APPROVED" | "REJECTED"): Promise<void> {
  const contract = await repo.findContract(tx, id, { deletedAt: null });
  if (!contract) throw new AppError("NOT_FOUND");
  if (contract.status !== "DRAFT") throw new AppError("APPROVAL_NOT_PENDING");
  const now = new Date();

  if (to === "REJECTED") {
    if ((await repo.moveStatus(tx, id, "DRAFT", "REJECTED")) === 0) throw new AppError("APPROVAL_NOT_PENDING");
    await recordAudit(tx, {
      actorUserId: decider.id,
      entityType: "contract",
      entityId: id,
      action: "contract.rejected",
      before: { status: "DRAFT" },
      after: { status: "REJECTED" },
    });
    return;
  }

  // A discount above what the approver's role may approve itself needs a role with a higher limit (A-112).
  if (!(await canApproveDiscount(tx, decider, discountPercentOfRecord(contract)))) {
    throw new AppError("DISCOUNT_ABOVE_LIMIT");
  }
  if ((await repo.approve(tx, id, decider.id, now)) === 0) throw new AppError("APPROVAL_NOT_PENDING");
  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "contract",
    entityId: id,
    action: "contract.activated",
    before: { status: "DRAFT" },
    after: { status: "ACTIVE" },
  });
  await markContracted(tx, decider, contract.customerId, now);
}

/** A-123: the lead status of a customer with an approved contract is "Đã ký hợp đồng" (CONTRACTED). */
async function markContracted(tx: Db, actor: Pick<Actor, "id">, customerId: string, now: Date): Promise<void> {
  const person = await tx.customer.findUnique({ where: { id: customerId }, select: { leadStatus: true } });
  if (!person || person.leadStatus === "CONTRACTED") return;
  await tx.customer.update({ where: { id: customerId }, data: { leadStatus: "CONTRACTED", leadStatusChangedAt: now } });
  await addStatusChange(tx, {
    customerId,
    fromStatus: person.leadStatus,
    toStatus: "CONTRACTED",
    changedById: actor.id,
    changedAt: now,
  });
  await recordAudit(tx, {
    actorUserId: actor.id,
    entityType: "lead",
    entityId: customerId,
    action: "lead.status_changed",
    before: { leadStatus: person.leadStatus },
    after: { leadStatus: "CONTRACTED" },
    context: { reason: "contract.approved" },
  });
}

/** The request that waits for this contract's approval, if any, and the contract as `actor` sees it. */
export async function pendingApprovalOf(
  actor: Actor,
  id: string,
): Promise<{ requestId: string | null; contract: ContractView }> {
  const contract = await contractView(prisma, actor, id);
  const request = await prisma.approvalRequest.findFirst({
    where: { actionType: "contract.create", entityId: id, status: "PENDING" },
    select: { id: true },
  });
  return { requestId: request?.id ?? null, contract };
}

/**
 * Updates the contract's note, also after approval: notes are not part of what was sold (A-122, A-127). Its own
 * permission, and audited with the old and the new text.
 */
export async function updateContractNote(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.note");
  const { notes } = parseInput(contractNoteSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const before = await getOrThrow(tx, actor, id);
    if (before.notes !== notes) {
      await tx.contract.update({ where: { id }, data: { notes } });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: id,
        action: "contract.note_updated",
        before: { notes: before.notes },
        after: { notes },
      });
    }
    return presentOne(tx, await getOrThrow(tx, actor, id), gymToday(), actor);
  });
}

/** The package history tab (brief §5.3): every recorded change of the contract, newest first. */
export async function contractHistory(actor: Actor, id: string): Promise<AuditEvent[]> {
  assertCan(actor, "contract.view");
  await getOrThrow(prisma, actor, id);
  const rows = await prisma.auditEvent.findMany({
    where: { entityType: "contract", entityId: id },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const values = (json: Prisma.JsonValue | null) =>
    json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    before: values(row.before),
    after: values(row.after),
    context: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}

/**
 * A-124: sends an approved contract back to pending approval, with a reason, when nothing depends on it: no receipts
 * that count and no recorded sessions. The new request is in the creator's name, so the creator cannot approve it
 * again (D-018). Admin only.
 */
export async function unapproveContract(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.unapprove");
  const { reasonId, reasonNote } = parseInput(unapproveSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const today = gymToday();

  return withPendingConflictMapped(() =>
    prisma.$transaction(async (tx) => {
      if (!(await repo.lockContract(tx, id))) throw new AppError("NOT_FOUND");
      const before = await getOrThrow(tx, actor, id);
      if (!canUnapprove(before.status)) throw new AppError("INVALID_STATUS_TRANSITION");
      await assertNoDependents(tx, id);
      const reason = await resolveChoice(tx, "unapproveReasons", "reasonId", { optionId: reasonId, note: reasonNote });
      const option = await tx.option.findUniqueOrThrow({ where: { id: reason.optionId }, select: chosenSelect });
      if ((await repo.unapprove(tx, id)) === 0) throw new AppError("INVALID_STATUS_TRANSITION");

      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract",
        entityId: id,
        action: "contract.unapproved",
        before: { status: "ACTIVE", approvedById: before.approvedById },
        after: { status: "DRAFT" },
        context: { reason: option.labelVi, note: reason.note },
      });
      await submitForApproval(
        tx,
        { id: before.createdById },
        {
          action: "contract.create",
          entityType: "contract",
          entityId: id,
          branchId: before.branchId,
          title: titleOf(before.contractCode, before.customer.fullName),
          amount: Number(before.contractValue),
          payload: { contractCode: before.contractCode, unapproved: true },
        },
      );
      return presentOne(tx, await getOrThrow(tx, actor, id), today, actor);
    }, LOCKING_TRANSACTION),
  );
}

/**
 * A-125, brief §5.4: deletes a contract to the trash with a reason, when no receipts that count and no recorded
 * sessions depend on it (they are deleted first, and the answer lists them). When the matrix requires it, the deletion
 * waits for approval and the contract stays in effect until then (D-018). Admin only.
 */
export async function deleteContract(
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ approval: { id: string } } | null> {
  assertCan(actor, "contract.delete");
  const { reasonId, reasonNote } = parseInput(deleteSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");

  return withPendingConflictMapped(() =>
    prisma.$transaction(async (tx) => {
      if (!(await repo.lockContract(tx, id))) throw new AppError("NOT_FOUND");
      const contract = await getOrThrow(tx, actor, id);
      await assertNoDependents(tx, id);
      const reason = await resolveChoice(tx, "deleteReasons", "reasonId", { optionId: reasonId, note: reasonNote });
      if ((await ruleFor(tx, "record.delete")).required) {
        const option = await tx.option.findUniqueOrThrow({ where: { id: reason.optionId }, select: chosenSelect });
        const approval = await submitForApproval(tx, actor, {
          action: "record.delete",
          entityType: "contract",
          entityId: id,
          branchId: contract.branchId,
          title: titleOf(contract.contractCode, contract.customer.fullName),
          amount: Number(contract.contractValue),
          payload: { reason: chosen(option, reason.note) },
        });
        return { approval };
      }
      await applyContractDeletion(tx, actor, id, reason);
      return null;
    }, LOCKING_TRANSACTION),
  );
}

/** Deletes the contract now, under the lock the caller holds: marks it, trash entry, audit, withdraws its requests. */
export async function applyContractDeletion(
  tx: Db,
  deleter: Pick<Actor, "id">,
  id: string,
  reason: { optionId: string; note: string | null },
): Promise<void> {
  const contract = await repo.findContract(tx, id, { deletedAt: null });
  if (!contract) throw new AppError("NOT_FOUND");
  await assertNoDependents(tx, id);
  const view = await presentOne(tx, contract, gymToday());
  const deletedAt = new Date();
  const marked = await repo.markDeleted(tx, id, {
    deletedAt,
    deletedById: deleter.id,
    deleteReasonId: reason.optionId,
    deleteReasonNote: reason.note,
  });
  if (marked !== 1) throw new AppError("NOT_FOUND");
  await moveToTrash(
    tx,
    deleter,
    {
      entityType: "contract",
      entityId: id,
      branchId: contract.branchId,
      title: titleOf(contract.contractCode, contract.customer.fullName),
      amount: view.contractValue,
      snapshot: encode(contractSchema, view) as Record<string, unknown>,
    },
    reason,
    deletedAt,
  );
  await cancelPendingFor(tx, id);
}

/** D-022, brief §5.4: receipts and sessions are dealt with before the contract; the error lists what is left. */
async function assertNoDependents(tx: Db, id: string): Promise<void> {
  const { payments, bookings } = await repo.findDependents(tx, id);
  if (payments.length + bookings.length === 0) return;
  throw new AppError("CONTRACT_HAS_DEPENDENTS", {
    dependents: [
      ...payments.map((row) => ({
        kind: "payment" as const,
        id: row.id,
        label: `${Number(row.amount)} · ${row.paidOn.toISOString().slice(0, 10)}`,
      })),
      ...bookings.map((row) => ({
        kind: "booking" as const,
        id: row.id,
        label: `${row.scheduledStart.toISOString()} · ${row.status}`,
      })),
    ],
  });
}

function titleOf(contractCode: string, customerName: string): string {
  return `${contractCode} · ${customerName}`;
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
    if (before.status === "CANCELLED") return presentOne(tx, before, today, actor);
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
    return presentOne(tx, await getOrThrow(tx, actor, id), today, actor);
  }, LOCKING_TRANSACTION);
}

/** Who can be named on a contract of a branch: the user's own branch when none is asked (A-115). */
export async function staffChoices(actor: Actor, rawQuery: unknown): Promise<ContractStaff[]> {
  assertCan(actor, "contract.create");
  const { branchId } = parseInput(contractStaffQuerySchema, rawQuery);
  const branches = actor.branches === "ALL" ? null : [...actor.branches];
  const chosen = branchId ?? branches?.[0];
  if (!chosen || (branches && !branches.includes(chosen))) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { branchId: ["required"] } });
  }
  return repo.listBranchStaff(prisma, chosen);
}

type Built = {
  write: repo.ContractWrite;
  shares: (Share & { role: "PT" | "SALE" })[];
  companionIds: string[];
};

/**
 * Works out everything a contract stores from what staff entered (FR-CON-001, FR-CON-002): the tier of the version in
 * force on the contract date, the promotion and voucher, the exception price, VAT, the end date, and the display name;
 * and checks the shares and companions. Nothing the client sends decides a price (BR-301).
 */
async function build(
  tx: Db,
  actor: Actor,
  customer: { id: string; branchId: string },
  data: ContractData,
): Promise<Built> {
  const today = gymToday();
  const contractDate = data.contractDate ?? today;
  const startDate = data.startDate ?? contractDate;

  const { service, tier } = await priceAt(tx, actor, data.serviceId, data.sessions, contractDate).catch(
    (error: unknown) => {
      // A service the actor cannot see is the same as one that does not exist.
      if (error instanceof AppError && error.code === "NOT_FOUND") {
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { serviceId: ["invalidChoice"] } });
      }
      throw error;
    },
  );
  if (!onSaleIn(service, customer.branchId, contractDate)) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { serviceId: ["serviceNotOnSale"] } });
  }

  // Prices (BR-301, BR-302): the tier's, or an agreed price with a reason; promotions and VAT as in the quote.
  const isException = data.proposedUnitPrice !== null && data.proposedUnitPrice !== tier.unitPrice;
  const approvedUnitPrice = isException ? (data.proposedUnitPrice as number) : tier.unitPrice;
  const reason = isException
    ? await resolveChoice(tx, "exceptionPriceReasons", "exceptionReasonId", {
        optionId: data.exceptionReasonId as string,
        note: data.exceptionNote,
      })
    : null;
  const { promotion, voucher } = await resolveOffers(service.id, contractDate, {
    promotionId: data.promotionId,
    voucherCode: data.voucherCode,
  });
  const breakdown = priceBreakdown({
    unitPrice: approvedUnitPrice,
    sessions: data.sessions,
    promotion: promotion && discountOfOffer(promotion),
    voucher: voucher && discountOfOffer(voucher),
    vatPercent: data.vatPercent,
  });

  // The renewed contract is the customer's own.
  if (data.previousContractId && !(await repo.findContractOfCustomer(tx, data.previousContractId, customer.id))) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { previousContractId: ["invalidChoice"] } });
  }

  const shares = await checkShares(tx, customer.branchId, service.kind, data);
  const companionIds = await checkCompanions(tx, actor, customer, service, data.companionIds);

  const endDate = contractEndDate(
    startDate,
    { months: tier.validityMonths, days: tier.validityDays },
    { months: data.bonusMonths, days: data.bonusDays },
  );
  return {
    write: {
      packageName: displayNameOf(service.name, data.sessions),
      serviceId: service.id,
      priceTierId: tier.id,
      contractType: data.contractType,
      previousContractId: data.previousContractId,
      contractDate,
      contractValue: breakdown.total,
      totalSessions: data.sessions,
      bonusSessions: data.bonusSessions,
      bonusMonths: data.bonusMonths,
      bonusDays: data.bonusDays,
      tierMonths: tier.validityMonths,
      tierDays: tier.validityDays,
      startDate,
      endDate,
      activationDeadline: data.activationDeadline,
      tierUnitPrice: tier.unitPrice,
      approvedUnitPrice,
      isExceptionPrice: isException,
      exceptionReasonId: reason?.optionId ?? null,
      exceptionNote: reason?.note ?? null,
      promotionId: promotion?.id ?? null,
      voucherId: voucher?.id ?? null,
      promotionDiscount: breakdown.promotionDiscount,
      voucherDiscount: breakdown.voucherDiscount,
      vatPercent: data.vatPercent,
      vatAmount: breakdown.vatAmount,
      signed: data.signed,
      signedOn: data.signed ? data.signedOn : null,
      signedBy: data.signed ? data.signedBy : null,
      signatureNote: data.signatureNote,
      paymentDueOn: data.paymentDueOn,
      notes: data.notes,
      isImported: false,
    },
    shares,
    companionIds,
  };
}

/** The PT and Sale shares (A-115): who, whether they may be named, and 100 in total per role. */
async function checkShares(
  tx: Db,
  branchId: string,
  serviceKind: "PT" | "CLASS" | "MEMBER",
  data: ContractData,
): Promise<(Share & { role: "PT" | "SALE" })[]> {
  const fieldErrors: Record<string, string[]> = {};
  const ptRequired = ptSharesRequired(serviceKind);
  if (!ptRequired && data.ptShares.length > 0) fieldErrors.ptShares = ["ptSharesNotAllowed"];
  const ptProblems = sharesProblems(data.ptShares, ptRequired);
  if (ptProblems.length > 0) fieldErrors.ptShares = ptProblems;
  const saleProblems = sharesProblems(data.saleShares, true);
  if (saleProblems.length > 0) fieldErrors.saleShares = saleProblems;

  const named = [...data.ptShares, ...data.saleShares].map((share) => share.employeeId);
  const employees = new Map((await repo.findEmployees(tx, [...new Set(named)])).map((row) => [row.id, row]));
  const usable = (id: string, trainer: boolean) => {
    const employee = employees.get(id);
    return Boolean(
      employee && employee.status === "ACTIVE" && employee.branchId === branchId && (!trainer || employee.isTrainer),
    );
  };
  if (data.ptShares.some((share) => !usable(share.employeeId, true))) fieldErrors.ptShares = ["invalidChoice"];
  if (data.saleShares.some((share) => !usable(share.employeeId, false))) fieldErrors.saleShares = ["invalidChoice"];
  if (Object.keys(fieldErrors).length > 0) throw new AppError("VALIDATION_FAILED", { fieldErrors });

  return [
    ...data.ptShares.map((share) => ({ ...share, role: "PT" as const })),
    ...data.saleShares.map((share) => ({ ...share, role: "SALE" as const })),
  ];
}

/** The other members of a group package (A-116): only for group services, up to the limit, customers of the branch. */
async function checkCompanions(
  tx: Db,
  actor: Actor,
  customer: { id: string; branchId: string },
  service: { isGroup: boolean; maxMembers: number | null },
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const fail = (message: string) => new AppError("VALIDATION_FAILED", { fieldErrors: { companionIds: [message] } });
  if (!service.isGroup) throw fail("companionsNotAllowed");
  if (ids.includes(customer.id)) throw fail("invalidChoice");
  if (ids.length > (service.maxMembers ?? 1) - 1) throw fail("tooManyCompanions");
  const found = await repo.findCompanionCandidates(tx, ids, customersVisibleTo(actor));
  if (found.length !== ids.length || found.some((row) => row.branchId !== customer.branchId))
    throw fail("invalidChoice");
  return ids;
}

/** The total discount against the tier price, in percent (A-112); 0 for a contract with no tier. */
function discountPercentOfRecord(contract: repo.ContractRecord): number {
  if (contract.tierUnitPrice === null) return 0;
  const tierTotal = Number(contract.tierUnitPrice) * contract.totalSessions;
  const paidBeforeVat = Number(contract.contractValue) - Number(contract.vatAmount);
  return discountPercentOf(tierTotal, Math.max(0, tierTotal - paidBeforeVat));
}

const sharesKey = (shares: repo.ContractRecord["shares"]) =>
  shares.map((share) => `${share.role}:${share.employee.id}:${Number(share.percent)}`).join(",");

/** The request's content, to tell a replay from another request that reuses the key (T-015). */
function fingerprintOf(customerId: string, actor: Actor, data: ContractData): string {
  return createHash("sha256")
    .update(JSON.stringify({ customerId, actorId: actor.id, data }))
    .digest("hex");
}

/** A UUID derived from the contract's key, so a retried create replays its first payment instead of repeating it. */
function keyDerivedFrom(key: string, purpose: string): string {
  const hex = createHash("sha256").update(`${key}:${purpose}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function replayOf(
  key: string,
  customerId: string,
  fingerprint: string,
  actor: Actor,
): Promise<ContractView | null> {
  const existing = await repo.findContractByIdempotencyKey(prisma, key);
  if (!existing) return null;
  const same =
    existing.customerId === customerId &&
    existing.createdById === actor.id &&
    existing.requestFingerprint === fingerprint;
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return presentOne(prisma, existing, gymToday(), actor);
}

async function getOrThrow(db: Db, actor: Actor, id: string): Promise<repo.ContractRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const contract = await repo.findContract(db, id, contractsVisibleTo(actor));
  if (!contract) throw new AppError("NOT_FOUND");
  return contract;
}

/** Contract views with their confirmed payments (BR-013), read with `db`. */
/** `actor` decides what is masked (D-017); without one the customer's phone is left out. */
async function present(
  db: Db,
  contracts: repo.ContractRecord[],
  today: Date,
  actor?: Pick<Actor, "masks">,
): Promise<ContractView[]> {
  const ids = contracts.map((c) => c.id);
  const [paid, approvals] = await Promise.all([validPaidByContract(db, ids), repo.approvalsOf(db, ids)]);
  return contracts.map((contract) =>
    toView(contract, today, paid.get(contract.id) ?? 0, approvals.get(contract.id), actor),
  );
}

async function presentOne(
  db: Db,
  contract: repo.ContractRecord,
  today: Date,
  actor?: Pick<Actor, "masks">,
): Promise<ContractView> {
  const [view] = await present(db, [contract], today, actor);
  return view;
}

function toView(
  contract: repo.ContractRecord,
  today: Date,
  confirmedPaidAmount: number,
  approval: repo.ApprovalState | undefined,
  actor?: Pick<Actor, "masks">,
): ContractView {
  return {
    id: contract.id,
    contractCode: contract.contractCode,
    customer: customerRef(contract.customer),
    customerPhone: actor && !isMasked(actor, "customer.phone") ? contract.customer.phone : null,
    branch: contract.branch,
    packageName: contract.packageName,
    service: contract.service,
    contractType: contract.contractType,
    previousContract: contract.previousContract,
    contractDate: contract.contractDate,
    startDate: contract.startDate,
    endDate: contract.endDate,
    activationDeadline: contract.activationDeadline,
    status: effectiveStatus(contract, today),
    createdAt: contract.createdAt,
    sessionsBought: contract.totalSessions,
    bonusSessions: contract.bonusSessions,
    bonusMonths: contract.bonusMonths,
    bonusDays: contract.bonusDays,
    tierUnitPrice: contract.tierUnitPrice === null ? null : Number(contract.tierUnitPrice),
    approvedUnitPrice: Number(contract.approvedUnitPrice),
    isExceptionPrice: contract.isExceptionPrice,
    exceptionReason: contract.exceptionReason && chosen(contract.exceptionReason, contract.exceptionNote),
    exceptionNote: contract.exceptionNote,
    promotion: contract.promotion,
    voucher: contract.voucher,
    promotionDiscount: Number(contract.promotionDiscount),
    voucherDiscount: Number(contract.voucherDiscount),
    vatPercent: Number(contract.vatPercent),
    vatAmount: Number(contract.vatAmount),
    discountPercent: discountPercentOfRecord(contract),
    shares: contract.shares.map((share) => ({
      role: share.role,
      employee: share.employee,
      percent: Number(share.percent),
    })),
    companions: contract.companions.map((row) => customerRef(row.customer)),
    signed: contract.signed,
    signedOn: contract.signedOn,
    signedBy: contract.signedBy,
    signatureNote: contract.signatureNote,
    paymentDueOn: contract.paymentDueOn,
    notes: contract.notes,
    isImported: contract.isImported,
    createdBy: contract.createdBy,
    approvedBy: contract.approvedBy,
    approvedAt: contract.approvedAt,
    rejection:
      contract.status === "REJECTED" && approval?.rejected
        ? { by: approval.rejected.by, at: approval.rejected.at, reason: approval.rejected.reason }
        : null,
    approvalPending: contract.status === "DRAFT" && Boolean(approval?.pending),
    ...contractFigures({
      totalSessions: entitledSessions(contract.totalSessions, contract.bonusSessions),
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
  return { AND: [inBranches(actor), isOwnOnly(actor, "contracts") ? own : {}, { deletedAt: null }] };
}
