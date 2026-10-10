import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { moveToTrash } from "../../platform/trash/trash.service.js";
import { encode } from "../../platform/http/encode.js";
import { deleteSchema } from "@flow/shared/trash";
import type { ChosenOption } from "@flow/shared/options";
import { findContract, lockContract } from "../contracts/contract.repository.js";
import { contractViewsByIds, contractsVisibleTo, type ContractView } from "../contracts/contract.service.js";
import { idempotencyKeySchema } from "@flow/shared/contracts";
import * as repo from "./payment.repository.js";
import {
  exceedsContractValue,
  isFutureDay,
  debtListSchema,
  listPaymentsSchema,
  paymentInputSchema,
  paymentSchema,
  periodSchema,
  type PaymentData,
} from "@flow/shared/finance";

/** What the UI and API see. */
export type PaymentView = {
  id: string;
  amount: number;
  method: ChosenOption;
  paidOn: Date;
  createdAt: Date;
  createdBy: string;
  contract: { id: string; contractCode: string; packageName: string };
  customer: { id: string; customerCode: string; fullName: string };
};

export type PaymentPage = { items: PaymentView[]; total: number; page: number; pageSize: number };

export async function listPayments(actor: Actor, rawQuery: unknown): Promise<PaymentPage> {
  assertCan(actor, "payment.view");
  const query = parseInput(listPaymentsSchema, rawQuery);
  const where: Prisma.PaymentWhereInput = {
    AND: [
      paymentsVisibleTo(actor),
      {
        contractId: query.contractId,
        contract: query.customerId ? { customerId: query.customerId } : undefined,
        paidOn: { gte: query.from, lte: query.to },
      },
    ],
  };
  const { items, total } = await repo.listPayments(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: items.map(toView), total, page: query.page, pageSize: query.pageSize };
}

/**
 * Confirmed payments received between two gym days, inclusive (D-011: no opening
 * balances), over the payments the actor may see; null when receipt totals are hidden
 * from the actor (D-017).
 */
export async function collectedBetween(actor: Actor, rawPeriod: unknown): Promise<number | null> {
  assertCan(actor, "payment.view");
  const { from, to } = parseInput(periodSchema, rawPeriod);
  if (isMasked(actor, "receipts.totals")) return null;
  return repo.sumValidPayments(prisma, { AND: [paymentsVisibleTo(actor), { paidOn: { gte: from, lte: to } }] });
}

/**
 * Which payments an actor may see: their branches, and with "own" voucher scope only
 * the ones they recorded (D-017, A-029).
 */
export function paymentsVisibleTo(actor: Actor): Prisma.PaymentWhereInput {
  return { AND: [inBranches(actor), isOwnOnly(actor, "vouchers") ? { createdById: actor.id } : {}] };
}

/**
 * Records a CONFIRMED payment (T-015, A-008). A replay with the same key and content
 * returns the original; the same key with other content is refused. Runs under the
 * contract lock, so two payments cannot together take the paid amount above the
 * contract value (OQ-003 interim, T-040).
 */
export async function recordPayment(
  actor: Actor,
  contractId: string,
  input: unknown,
  idempotencyKey: unknown,
): Promise<{ payment: PaymentView; replayed: boolean }> {
  assertCan(actor, "payment.record");
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const data = parseInput(paymentInputSchema, input);
  if (isFutureDay(data.paidOn, gymToday())) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { paidOn: ["futureDate"] } });
  }
  if (!z.uuid().safeParse(contractId).success) throw new AppError("NOT_FOUND");

  const replay = await replayOf(prisma, key.data, contractId, data, actor);
  if (replay) return { payment: replay, replayed: true };

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockContract(tx, contractId))) throw new AppError("NOT_FOUND");
      // The same request sent twice at once waits here for the first; it is a replay,
      // not a second payment that would exceed the contract value.
      const replayUnderLock = await replayOf(tx, key.data, contractId, data, actor);
      if (replayUnderLock) return { payment: replayUnderLock, replayed: true };

      // An active option of the list; "Khác" needs a note (D-016).
      const method = await resolveChoice(tx, "paymentMethods", "methodId", { optionId: data.methodId, note: data.methodNote });

      // Only on a contract the actor can see (D-017).
      const contract = await findContract(tx, contractId, contractsVisibleTo(actor));
      if (!contract) throw new AppError("NOT_FOUND");
      // OQ-013 interim: nothing new is collected on a cancelled contract.
      if (contract.status === "CANCELLED") throw new AppError("PAYMENT_CONTRACT_CANCELLED");
      const confirmedPaidAmount = await repo.sumValidPayments(tx, { contractId });
      const figures = {
        contractValue: Number(contract.contractValue),
        openingPaidAmount: Number(contract.openingPaidAmount),
        confirmedPaidAmount,
      };
      if (exceedsContractValue(figures, data.amount)) throw new AppError("PAYMENT_EXCEEDS_CONTRACT_VALUE");

      // A payment belongs to its contract's branch (D-014).
      const payment = await repo.createPayment(tx, {
        amount: data.amount,
        paidOn: data.paidOn,
        methodId: method.optionId,
        methodNote: method.note,
        contractId,
        branchId: contract.branchId,
        idempotencyKey: key.data,
        createdById: actor.id,
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "payment",
        entityId: payment.id,
        action: "payment.created",
        after: {
          contractId,
          amount: data.amount,
          method: { optionId: method.optionId, note: method.note },
          paidOn: data.paidOn.toISOString().slice(0, 10),
        },
      });
      return { payment: toView(payment), replayed: false };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    // The same key used for another contract at the same moment: the unique key decides.
    if (!isUniqueViolation(error)) throw error;
    const replayAfterRace = await replayOf(prisma, key.data, contractId, data, actor);
    if (replayAfterRace) return { payment: replayAfterRace, replayed: true };
    throw error;
  }
}

/**
 * Deletes a payment to the trash with a reason from the list (D-035, D-016). It leaves
 * lists and stops counting toward the paid amount and debt at once, and is never
 * reinstated. Runs under the contract lock (T-040), so it cannot interleave with a new
 * payment's check against the contract value; a payment already deleted is NOT_FOUND.
 */
export async function deletePayment(actor: Actor, id: string, input: unknown): Promise<void> {
  assertCan(actor, "payment.delete");
  const { reasonId, reasonNote } = parseInput(deleteSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    const found = await repo.findPayment(tx, id, paymentsVisibleTo(actor));
    if (!found) throw new AppError("NOT_FOUND");
    // Lock order: contract, then the payment (T-040).
    await lockContract(tx, found.contractId);
    const payment = await repo.findPayment(tx, id);
    if (!payment) throw new AppError("NOT_FOUND");

    const reason = await resolveChoice(tx, "deleteReasons", "reasonId", { optionId: reasonId, note: reasonNote });
    const deletedAt = new Date();
    const marked = await repo.markPaymentDeleted(tx, id, {
      deletedAt,
      deletedById: actor.id,
      deleteReasonId: reason.optionId,
      deleteReasonNote: reason.note,
    });
    if (marked !== 1) throw new AppError("NOT_FOUND");
    const view = toView(payment);
    await moveToTrash(
      tx,
      actor,
      {
        entityType: "payment",
        entityId: id,
        branchId: payment.branchId,
        title: `${view.contract.contractCode} · ${view.customer.fullName}`,
        amount: view.amount,
        snapshot: encode(paymentSchema, view) as Record<string, unknown>,
      },
      reason,
      deletedAt,
    );
  }, LOCKING_TRANSACTION);
}

/** Contracts that still owe money, largest debt first (BR-013, A-022). */
export async function listDebts(
  actor: Actor,
  rawQuery: unknown,
): Promise<{ items: ContractView[]; total: number; page: number; pageSize: number }> {
  assertCan(actor, "payment.view");
  const query = parseInput(debtListSchema, rawQuery);
  const scope: repo.DebtScope = {
    branchIds: actor.branches === "ALL" ? "ALL" : [...actor.branches],
    ownBy: isOwnOnly(actor, "contracts") ? { userId: actor.id, trainerId: actor.trainerId } : null,
  };
  const { ids, total } = await repo.contractsWithDebt(prisma, scope, { skip: (query.page - 1) * query.pageSize, take: query.pageSize });
  return { items: await contractViewsByIds(actor, ids), total, page: query.page, pageSize: query.pageSize };
}

async function replayOf(db: Db, key: string, contractId: string, data: PaymentData, actor: Actor): Promise<PaymentView | null> {
  const existing = await repo.findPaymentByIdempotencyKey(db, key);
  if (!existing) return null;
  const same =
    existing.contractId === contractId &&
    existing.createdById === actor.id &&
    Number(existing.amount) === data.amount &&
    existing.methodId === data.methodId &&
    existing.methodNote === data.methodNote &&
    existing.paidOn.getTime() === data.paidOn.getTime();
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return toView(existing);
}

function toView(payment: repo.PaymentRecord): PaymentView {
  const { customer, ...contract } = payment.contract;
  return {
    id: payment.id,
    amount: Number(payment.amount),
    method: chosen(payment.method, payment.methodNote),
    paidOn: payment.paidOn,
    createdAt: payment.createdAt,
    createdBy: payment.createdBy.name,
    contract,
    customer,
  };
}

function gymToday(): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE);
}
