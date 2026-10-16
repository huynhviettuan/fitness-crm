import { queueContractEmail } from "../contracts/contract-email.js";
import { z } from "zod";
import { customerRef } from "../customers/person.service.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen, chosenSelect, resolveChoice } from "../../platform/options/option.service.js";
import { moveToTrash } from "../../platform/trash/trash.service.js";
import {
  cancelPendingFor,
  ruleFor,
  submitForApproval,
  withPendingConflictMapped,
} from "../../platform/approvals/approval.engine.js";
import type { RecordApprovalStatus } from "@gymcrm/shared/approvals";
import type { Db as TxDb } from "../../platform/db/prisma.js";
import { encode } from "../../platform/http/encode.js";
import { attachFileSchema } from "@gymcrm/shared/files";
import { claimFile } from "../../platform/files/file.service.js";
import { deleteSchema } from "@gymcrm/shared/trash";
import type { ChosenOption } from "@gymcrm/shared/options";
import { findContract, lockContract } from "../contracts/contract.repository.js";
import { contractViewsByIds, contractsVisibleTo, type ContractView } from "../contracts/contract.service.js";
import { idempotencyKeySchema, valueOfContract } from "@gymcrm/shared/contracts";
import * as repo from "./payment.repository.js";
import {
  exceedsContractValue,
  isFutureDay,
  debtListSchema,
  listPaymentsSchema,
  paymentInputSchema,
  paymentSchema,
  periodSchema,
  receiptDateSchema,
  type PaymentData,
} from "@gymcrm/shared/finance";

/** What the UI and API see. */
export type PaymentView = {
  id: string;
  receiptNumber: string;
  amount: number;
  method: ChosenOption;
  saleEmployee: { id: string; employeeCode: string; fullName: string } | null;
  note: string | null;
  proofFileId: string | null;
  paidOn: Date;
  approvalStatus: RecordApprovalStatus;
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
 * Records a payment (T-015). When the matrix requires it, the payment is PENDING and
 * counts only once someone else approves it (D-018). A replay with the same key and
 * content returns the original; the same key with other content is refused. Runs
 * under the contract lock, so payments, pending ones included, cannot together take
 * the paid amount above the contract value (OQ-003 interim, A-038, T-040).
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
    return await prisma.$transaction(
      (tx) => recordPaymentIn(tx, actor, contractId, data, key.data),
      LOCKING_TRANSACTION,
    );
  } catch (error) {
    // The same key used for another contract at the same moment: the unique key decides.
    if (!isUniqueViolation(error)) throw error;
    const replayAfterRace = await replayOf(prisma, key.data, contractId, data, actor);
    if (replayAfterRace) return { payment: replayAfterRace, replayed: true };
    throw error;
  }
}

/**
 * The recording itself, inside the caller's transaction: a contract being made takes its first payment here, so the
 * contract and its receipt are saved together or not at all (A-119).
 */
export async function recordPaymentIn(
  tx: TxDb,
  actor: Actor,
  contractId: string,
  data: PaymentData,
  key: string,
): Promise<{ payment: PaymentView; replayed: boolean }> {
  if (!(await lockContract(tx, contractId))) throw new AppError("NOT_FOUND");
  // The same request sent twice at once waits here for the first; it is a replay,
  // not a second payment that would exceed the contract value.
  const replayUnderLock = await replayOf(tx, key, contractId, data, actor);
  if (replayUnderLock) return { payment: replayUnderLock, replayed: true };

  // An active option of the list; "Khác" needs a note (D-016).
  const method = await resolveChoice(tx, "paymentMethods", "methodId", {
    optionId: data.methodId,
    note: data.methodNote,
  });

  // Only on a contract the actor can see (D-017).
  const contract = await findContract(tx, contractId, contractsVisibleTo(actor));
  if (!contract) throw new AppError("NOT_FOUND");
  // OQ-013 interim: nothing new is collected on a cancelled contract.
  if (contract.status === "CANCELLED") throw new AppError("PAYMENT_CONTRACT_CANCELLED");
  const confirmedPaidAmount = await repo.sumCommittedPayments(tx, { contractId });
  const figures = {
    contractValue: valueOfContract(Number(contract.contractValue), Number(contract.voucherValue)),
    openingPaidAmount: Number(contract.openingPaidAmount),
    confirmedPaidAmount,
  };
  if (exceedsContractValue(figures, data.amount)) throw new AppError("PAYMENT_EXCEEDS_CONTRACT_VALUE");

  const rule = await ruleFor(tx, "payment.create");
  // A payment belongs to its contract's branch (D-014).
  const payment = await repo.createPayment(tx, {
    approvalStatus: rule.required ? "PENDING" : "APPROVED",
    amount: data.amount,
    paidOn: data.paidOn,
    methodId: method.optionId,
    methodNote: method.note,
    receiptNumber: await repo.nextReceiptNumber(tx),
    saleEmployeeId: await resolveSalesperson(tx, contract, data.saleEmployeeId),
    note: data.note,
    contractId,
    branchId: contract.branchId,
    idempotencyKey: key,
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
      approvalStatus: payment.approvalStatus,
      receiptNumber: payment.receiptNumber,
      saleEmployeeId: payment.saleEmployeeId,
    },
  });
  const view = toView(payment);
  if (rule.required) {
    await submitForApproval(tx, actor, {
      action: "payment.create",
      entityType: "payment",
      entityId: payment.id,
      branchId: payment.branchId,
      title: titleOf(view),
      amount: view.amount,
      payload: { contractId },
    });
  }
  // D-059: a receipt that has effect tells the customer; one waiting for approval does when it is approved.
  if (!rule.required) await emailReceipt(tx, payment.id, actor.id);
  return { payment: view, replayed: false };
}

/** The optional receipt email of a payment that now counts (M6.3, A-181); once per payment. */
async function emailReceipt(tx: TxDb, paymentId: string, by: string): Promise<void> {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { contractId: true, receiptNumber: true, amount: true, paidOn: true },
  });
  if (!payment) return;
  await queueContractEmail(tx, {
    event: "payment.received",
    causeId: paymentId,
    contractId: payment.contractId,
    by,
    day: payment.paidOn,
    payment: { receiptNumber: payment.receiptNumber, amount: Number(payment.amount) },
  });
}

/**
 * Deletes a payment to the trash with a reason from the list (D-035, D-016). When the
 * matrix requires it, the deletion waits for approval and the payment stays in effect
 * until then (D-018). Runs under the contract lock (T-040); a payment already deleted
 * is NOT_FOUND.
 */
export async function deletePayment(
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ approval: { id: string } } | null> {
  assertCan(actor, "payment.delete");
  const { reasonId, reasonNote } = parseInput(deleteSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");

  return withPendingConflictMapped(() =>
    prisma.$transaction(async (tx) => {
      const found = await repo.findPayment(tx, id, paymentsVisibleTo(actor));
      if (!found) throw new AppError("NOT_FOUND");
      // Lock order: contract, then the payment (T-040).
      await lockContract(tx, found.contractId);
      const payment = await repo.findPayment(tx, id);
      if (!payment) throw new AppError("NOT_FOUND");

      const reason = await resolveChoice(tx, "deleteReasons", "reasonId", { optionId: reasonId, note: reasonNote });
      if ((await ruleFor(tx, "record.delete")).required) {
        const view = toView(payment);
        const option = await tx.option.findUniqueOrThrow({ where: { id: reason.optionId }, select: chosenSelect });
        const approval = await submitForApproval(tx, actor, {
          action: "record.delete",
          entityType: "payment",
          entityId: id,
          branchId: payment.branchId,
          title: titleOf(view),
          amount: view.amount,
          payload: { reason: chosen(option, reason.note) },
        });
        return { approval };
      }
      await applyPaymentDeletion(tx, payment, actor, reason);
      return null;
    }, LOCKING_TRANSACTION),
  );
}

/**
 * Deletes the payment now, under the contract lock the caller holds: marks it, writes
 * the trash entry and audit (T-056), and withdraws its other pending requests.
 */
export async function applyPaymentDeletion(
  tx: TxDb,
  payment: repo.PaymentRecord,
  deleter: Pick<Actor, "id">,
  reason: { optionId: string; note: string | null },
): Promise<void> {
  const deletedAt = new Date();
  const marked = await repo.markPaymentDeleted(tx, payment.id, {
    deletedAt,
    deletedById: deleter.id,
    deleteReasonId: reason.optionId,
    deleteReasonNote: reason.note,
  });
  if (marked !== 1) throw new AppError("NOT_FOUND");
  const view = toView(payment);
  await moveToTrash(
    tx,
    deleter,
    {
      entityType: "payment",
      entityId: payment.id,
      branchId: payment.branchId,
      title: titleOf(view),
      amount: view.amount,
      snapshot: encode(paymentSchema, view) as Record<string, unknown>,
    },
    reason,
    deletedAt,
  );
  await cancelPendingFor(tx, payment.id);
}

/** For approvals: the payment a request is about, not deleted. */
export function findPaymentForApproval(tx: TxDb, id: string): Promise<repo.PaymentRecord | null> {
  return repo.findPayment(tx, id);
}

/** Approving or rejecting a pending payment (D-018), with its audit. */
export async function decidePayment(
  tx: TxDb,
  decider: Pick<Actor, "id">,
  id: string,
  to: "APPROVED" | "REJECTED",
): Promise<void> {
  if ((await repo.setPaymentApprovalStatus(tx, id, "PENDING", to)) !== 1) throw new AppError("APPROVAL_NOT_PENDING");
  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "payment",
    entityId: id,
    action: to === "APPROVED" ? "payment.approved" : "payment.rejected",
    before: { approvalStatus: "PENDING" },
    after: { approvalStatus: to },
  });
  if (to === "APPROVED") await emailReceipt(tx, id, decider.id);
}

function titleOf(view: PaymentView): string {
  return `${view.receiptNumber} · ${view.contract.contractCode} · ${view.customer.fullName}`;
}

/**
 * The salesperson a receipt is credited to (brief §8.1): the one chosen, an active employee of the contract's branch,
 * or by default the contract's Sale with the largest share (A-130).
 */
async function resolveSalesperson(
  tx: TxDb,
  contract: { branchId: string; shares: { role: string; percent: unknown; employee: { id: string } }[] },
  chosenId: string | null,
): Promise<string | null> {
  if (chosenId === null) {
    const sales = contract.shares.filter((share) => share.role === "SALE");
    sales.sort((a, b) => Number(b.percent) - Number(a.percent));
    return sales[0]?.employee.id ?? null;
  }
  const employee = await tx.employee.findFirst({
    where: { id: chosenId, branchId: contract.branchId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!employee) throw new AppError("VALIDATION_FAILED", { fieldErrors: { saleEmployeeId: ["invalidChoice"] } });
  return employee.id;
}

/**
 * Edits a receipt's date (D-034, FR-CASH-004): its own permission, the day cannot be in the future, and the change
 * is always logged with the old and the new day. Runs under the contract lock.
 */
export async function updateReceiptDate(actor: Actor, id: string, input: unknown): Promise<PaymentView> {
  assertCan(actor, "payment.editDate");
  const { paidOn } = parseInput(receiptDateSchema, input);
  if (isFutureDay(paidOn, gymToday())) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { paidOn: ["futureDate"] } });
  }
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const found = await repo.findPayment(tx, id, paymentsVisibleTo(actor));
    if (!found) throw new AppError("NOT_FOUND");
    await lockContract(tx, found.contractId);
    const before = await repo.findPayment(tx, id);
    if (!before) throw new AppError("NOT_FOUND");
    if (before.paidOn.getTime() !== paidOn.getTime()) {
      await tx.payment.update({ where: { id }, data: { paidOn } });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "payment",
        entityId: id,
        action: "payment.date_changed",
        before: { paidOn: before.paidOn.toISOString().slice(0, 10) },
        after: { paidOn: paidOn.toISOString().slice(0, 10) },
      });
    }
    return toView((await repo.findPayment(tx, id))!);
  }, LOCKING_TRANSACTION);
}

/**
 * Attaches the transfer proof picture to a receipt, or takes it off with null (brief §8.1, M4.1b, A-144). Whoever may
 * record receipts may add one, also after approval; the change is logged. The file must be a receipt picture the actor
 * uploaded and nobody has used.
 */
export async function setReceiptProof(actor: Actor, id: string, input: unknown): Promise<PaymentView> {
  assertCan(actor, "payment.record");
  const { fileId } = parseInput(attachFileSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const before = await repo.findPayment(tx, id, paymentsVisibleTo(actor));
    if (!before) throw new AppError("NOT_FOUND");
    if (fileId) await claimFile(tx, actor, fileId, "receipt_proof", before.proofFileId);
    await tx.payment.update({ where: { id }, data: { proofFileId: fileId } });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "payment",
      entityId: id,
      action: "payment.proof_changed",
      before: { proofFileId: before.proofFileId },
      after: { proofFileId: fileId },
    });
    return toView((await repo.findPayment(tx, id))!);
  });
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
    ownBy: isOwnOnly(actor, "contracts") ? { userId: actor.id, employeeId: actor.employeeId } : null,
  };
  const { ids, total } = await repo.contractsWithDebt(prisma, scope, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: await contractViewsByIds(actor, ids), total, page: query.page, pageSize: query.pageSize };
}

async function replayOf(
  db: Db,
  key: string,
  contractId: string,
  data: PaymentData,
  actor: Actor,
): Promise<PaymentView | null> {
  const existing = await repo.findPaymentByIdempotencyKey(db, key);
  if (!existing) return null;
  const same =
    existing.contractId === contractId &&
    existing.createdById === actor.id &&
    Number(existing.amount) === data.amount &&
    existing.methodId === data.methodId &&
    existing.methodNote === data.methodNote &&
    existing.saleEmployeeId === (data.saleEmployeeId ?? existing.saleEmployeeId) &&
    existing.note === data.note &&
    existing.paidOn.getTime() === data.paidOn.getTime();
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return toView(existing);
}

function toView(payment: repo.PaymentRecord): PaymentView {
  const { customer, ...contract } = payment.contract;
  return {
    id: payment.id,
    receiptNumber: payment.receiptNumber,
    amount: Number(payment.amount),
    method: chosen(payment.method, payment.methodNote),
    saleEmployee: payment.saleEmployee,
    note: payment.note,
    proofFileId: payment.proofFileId,
    paidOn: payment.paidOn,
    approvalStatus: payment.approvalStatus as RecordApprovalStatus,
    createdAt: payment.createdAt,
    createdBy: payment.createdBy.name,
    contract,
    customer: customerRef(customer),
  };
}

function gymToday(): Date {
  return calendarDateInTimeZone(env.GYM_TIMEZONE);
}
