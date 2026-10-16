import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, isMasked, isOwnOnly, resolveBranch } from "../../platform/permissions/scope.js";
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
import type { Db as TxDb } from "../../platform/db/prisma.js";
import type { RecordApprovalStatus } from "@gymcrm/shared/approvals";
import { encode } from "../../platform/http/encode.js";
import { deleteSchema } from "@gymcrm/shared/trash";
import { idempotencyKeySchema } from "@gymcrm/shared/contracts";
import * as repo from "./cash.repository.js";
import { findContract } from "../contracts/contract.repository.js";
import { contractsVisibleTo } from "../contracts/contract.service.js";
import { nextReceiptNumber, sumValidPayments } from "./payment.repository.js";
import { paymentsVisibleTo } from "./payment.service.js";
import {
  isFutureDay,
  cashTransactionInputSchema,
  listCashTransactionsSchema,
  cashTransactionSchema,
  periodSchema,
  type CashTransaction,
  type CashTransactionData,
} from "@gymcrm/shared/finance";

export type CashTransactionView = CashTransaction;

export type CashTransactionPage = { items: CashTransactionView[]; total: number; page: number; pageSize: number };

/**
 * Totals for a period (FR-CASH-002). Contract payments and other income stay separate
 * lines, with no net figure, until OQ-007 decides whether payments count as income.
 */
export type FinanceSummary = { contractPayments: number | null; otherIncome: number | null; expense: number | null };

export async function listCashTransactions(actor: Actor, rawQuery: unknown): Promise<CashTransactionPage> {
  assertCan(actor, "cash.manage");
  const query = parseInput(listCashTransactionsSchema, rawQuery);
  const where: Prisma.CashTransactionWhereInput = {
    AND: [cashVisibleTo(actor), { type: query.type, occurredOn: { gte: query.from, lte: query.to } }],
  };
  const { items, total } = await repo.listCashTransactions(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: items.map(toView), total, page: query.page, pageSize: query.pageSize };
}

export async function financeSummary(actor: Actor, rawPeriod: unknown): Promise<FinanceSummary> {
  assertCan(actor, "cash.manage");
  const { from, to } = parseInput(periodSchema, rawPeriod);
  // Totals hidden from the actor's role (D-017).
  if (isMasked(actor, "receipts.totals")) return { contractPayments: null, otherIncome: null, expense: null };
  const visible = cashVisibleTo(actor);
  const [contractPayments, otherIncome, expense] = await Promise.all([
    sumValidPayments(prisma, { AND: [paymentsVisibleTo(actor), { paidOn: { gte: from, lte: to } }] }),
    repo.sumValidCash(prisma, "INCOME", from, to, visible),
    repo.sumValidCash(prisma, "EXPENSE", from, to, visible),
  ]);
  return { contractPayments, otherIncome, expense };
}

/**
 * Records an income or expense (T-015). When the matrix requires it, the entry is
 * PENDING and counts only once someone else approves it (D-018). Replays behave like
 * payments.
 */
export async function recordCashTransaction(
  actor: Actor,
  input: unknown,
  idempotencyKey: unknown,
): Promise<{ transaction: CashTransactionView; replayed: boolean }> {
  assertCan(actor, "cash.manage");
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const data = parseInput(cashTransactionInputSchema, input);
  if (isFutureDay(data.occurredOn, calendarDateInTimeZone(env.GYM_TIMEZONE))) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { occurredOn: ["futureDate"] } });
  }

  const replay = await replayOf(key.data, data, actor);
  if (replay) return { transaction: replay, replayed: true };

  try {
    const created = await prisma.$transaction((tx) => createCashTransactionIn(tx, actor, data, key.data));
    return { transaction: toView(created), replayed: false };
  } catch (error) {
    // The same request submitted twice at once: the unique key lets one through.
    if (!isUniqueViolation(error)) throw error;
    const replayAfterRace = await replayOf(key.data, data, actor);
    if (replayAfterRace) return { transaction: replayAfterRace, replayed: true };
    throw error;
  }
}

/**
 * Records an income or expense inside the caller's transaction: its voucher number, audit, and a request for approval
 * when the matrix requires it (D-018). PT payouts make their expense voucher through it (M5.7).
 */
export async function createCashTransactionIn(
  tx: TxDb,
  actor: Actor,
  data: CashTransactionData,
  key: string,
): Promise<repo.CashTransactionRecord> {
  const branchId = await resolveBranch(tx, actor, data.branchId);
  // Income and expenses have their own lists; "Khác" needs a note (D-016).
  const list = data.type === "INCOME" ? "incomeCategories" : "expenseTypes";
  const category = await resolveChoice(tx, list, "categoryId", {
    optionId: data.categoryId,
    note: data.categoryNote,
  });
  const method = await resolveChoice(tx, "paymentMethods", "methodId", {
    optionId: data.methodId,
    note: data.methodNote,
  });
  // A refund is linked to a contract of the voucher's branch that the actor may see (D-034).
  if (data.contractId) {
    const contract = await findContract(tx, data.contractId, contractsVisibleTo(actor));
    if (!contract || contract.branchId !== branchId) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { contractId: ["invalidChoice"] } });
    }
  }
  const rule = await ruleFor(tx, "cash.create");
  const number = data.type === "INCOME" ? await nextReceiptNumber(tx) : await repo.nextExpenseNumber(tx);
  const transaction = await repo.createCashTransaction(tx, {
    ...data,
    number,
    methodId: method.optionId,
    methodNote: method.note,
    approvalStatus: rule.required ? "PENDING" : "APPROVED",
    categoryId: category.optionId,
    categoryNote: category.note,
    branchId,
    idempotencyKey: key,
    createdById: actor.id,
  });
  await recordAudit(tx, {
    actorUserId: actor.id,
    entityType: "cash_transaction",
    entityId: transaction.id,
    action: "cash_transaction.created",
    after: {
      number,
      type: data.type,
      category: { optionId: category.optionId, note: category.note },
      method: { optionId: method.optionId, note: method.note },
      payee: data.payee,
      contractId: data.contractId,
      amount: data.amount,
      occurredOn: data.occurredOn.toISOString().slice(0, 10),
      approvalStatus: transaction.approvalStatus,
    },
  });
  if (rule.required) {
    const view = toView(transaction);
    await submitForApproval(tx, actor, {
      action: "cash.create",
      entityType: "cash_transaction",
      entityId: transaction.id,
      branchId: transaction.branchId,
      title: titleOf(view),
      amount: view.amount,
      payload: { type: view.type },
    });
  }
  return transaction;
}

/**
 * Deletes an income or expense entry to the trash with a reason from the list (D-035,
 * D-016); a mistake is corrected by deleting it and recording it again. When the
 * matrix requires it, the deletion waits for approval (D-018). Deleting vouchers is its
 * own permission (09_RBAC.md). An entry already deleted is NOT_FOUND.
 */
export async function deleteCashTransaction(
  actor: Actor,
  id: string,
  input: unknown,
): Promise<{ approval: { id: string } } | null> {
  assertCan(actor, "cash.delete");
  const { reasonId, reasonNote } = parseInput(deleteSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");

  return withPendingConflictMapped(() =>
    prisma.$transaction(async (tx) => {
      const transaction = await repo.findCashTransaction(tx, id, cashVisibleTo(actor));
      if (!transaction) throw new AppError("NOT_FOUND");

      const reason = await resolveChoice(tx, "deleteReasons", "reasonId", { optionId: reasonId, note: reasonNote });
      if ((await ruleFor(tx, "record.delete")).required) {
        const view = toView(transaction);
        const option = await tx.option.findUniqueOrThrow({ where: { id: reason.optionId }, select: chosenSelect });
        const approval = await submitForApproval(tx, actor, {
          action: "record.delete",
          entityType: "cash_transaction",
          entityId: id,
          branchId: transaction.branchId,
          title: titleOf(view),
          amount: view.amount,
          payload: { reason: chosen(option, reason.note) },
        });
        return { approval };
      }
      await applyCashDeletion(tx, transaction, actor, reason);
      return null;
    }),
  );
}

/** Deletes the entry now: marks it, writes the trash entry and audit, withdraws its pending requests. */
export async function applyCashDeletion(
  tx: TxDb,
  transaction: repo.CashTransactionRecord,
  deleter: Pick<Actor, "id">,
  reason: { optionId: string; note: string | null },
): Promise<void> {
  const deletedAt = new Date();
  const marked = await repo.markCashTransactionDeleted(tx, transaction.id, {
    deletedAt,
    deletedById: deleter.id,
    deleteReasonId: reason.optionId,
    deleteReasonNote: reason.note,
  });
  if (marked !== 1) throw new AppError("NOT_FOUND");
  const view = toView(transaction);
  await moveToTrash(
    tx,
    deleter,
    {
      entityType: "cash_transaction",
      entityId: transaction.id,
      branchId: transaction.branchId,
      title: titleOf(view),
      amount: view.amount,
      snapshot: encode(cashTransactionSchema, view) as Record<string, unknown>,
    },
    reason,
    deletedAt,
  );
  await cancelPendingFor(tx, transaction.id);
}

/** For approvals: the entry a request is about, not deleted. */
export function findCashForApproval(tx: TxDb, id: string): Promise<repo.CashTransactionRecord | null> {
  return repo.findCashTransaction(tx, id);
}

/** Approving or rejecting a pending entry (D-018), with its audit. */
export async function decideCashTransaction(
  tx: TxDb,
  decider: Pick<Actor, "id">,
  id: string,
  to: "APPROVED" | "REJECTED",
): Promise<void> {
  if ((await repo.setCashApprovalStatus(tx, id, "PENDING", to)) !== 1) throw new AppError("APPROVAL_NOT_PENDING");
  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "cash_transaction",
    entityId: id,
    action: to === "APPROVED" ? "cash_transaction.approved" : "cash_transaction.rejected",
    before: { approvalStatus: "PENDING" },
    after: { approvalStatus: to },
  });
}

function titleOf(view: CashTransactionView): string {
  const category = view.category.note ? `${view.category.labelVi}: ${view.category.note}` : view.category.labelVi;
  return `${view.number} · ${category}`;
}

async function replayOf(key: string, data: CashTransactionData, actor: Actor): Promise<CashTransactionView | null> {
  const existing = await repo.findCashTransactionByIdempotencyKey(prisma, key);
  if (!existing) return null;
  const same =
    existing.createdById === actor.id &&
    existing.type === data.type &&
    existing.categoryId === data.categoryId &&
    existing.categoryNote === data.categoryNote &&
    existing.methodId === data.methodId &&
    existing.methodNote === data.methodNote &&
    existing.payee === data.payee &&
    existing.contractId === data.contractId &&
    Number(existing.amount) === data.amount &&
    existing.description === data.description &&
    existing.reference === data.reference &&
    existing.occurredOn.getTime() === data.occurredOn.getTime();
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return toView(existing);
}

function toView(transaction: repo.CashTransactionRecord): CashTransactionView {
  return {
    id: transaction.id,
    number: transaction.number,
    branch: transaction.branch,
    type: transaction.type,
    category: chosen(transaction.category, transaction.categoryNote),
    method: chosen(transaction.method, transaction.methodNote),
    payee: transaction.payee,
    contract: transaction.contract,
    amount: Number(transaction.amount),
    description: transaction.description,
    reference: transaction.reference,
    occurredOn: transaction.occurredOn,
    approvalStatus: transaction.approvalStatus as RecordApprovalStatus,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy.name,
  };
}

/**
 * Which income and expense records an actor may see: their branches, and with "own"
 * voucher scope only the ones they recorded (D-017, A-029).
 */
function cashVisibleTo(actor: Actor): Prisma.CashTransactionWhereInput {
  return { AND: [inBranches(actor), isOwnOnly(actor, "vouchers") ? { createdById: actor.id } : {}] };
}
