import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isUniqueViolation } from "@/lib/db/errors";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { assertCan } from "@/lib/permissions/assert";
import { parseInput } from "@/lib/validation/parse";
import type { Actor } from "@/lib/auth/session";
import { recordAudit } from "@/modules/audit/audit.repository";
import { idempotencyKeySchema } from "@flow/shared/contracts";
import * as repo from "@/modules/finance/cash.repository";
import { sumConfirmedPayments } from "@/modules/finance/payment.repository";
import {
  isFutureDay,
  cashTransactionInputSchema,
  listCashTransactionsSchema,
  periodSchema,
  voidSchema,
  type CashTransactionData,
} from "@flow/shared/finance";

/** What the UI and API see. */
export type CashTransactionView = {
  id: string;
  type: "INCOME" | "EXPENSE";
  category: string;
  amount: number;
  description: string | null;
  reference: string | null;
  occurredOn: Date;
  status: "CONFIRMED" | "VOIDED";
  createdAt: Date;
  createdBy: string;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
};

export type CashTransactionPage = { items: CashTransactionView[]; total: number; page: number; pageSize: number };

/**
 * Totals for a period (FR-CASH-002). Contract payments and other income stay separate
 * lines, with no net figure, until OQ-007 decides whether payments count as income.
 */
export type FinanceSummary = { contractPayments: number; otherIncome: number; expense: number };

export async function listCashTransactions(actor: Actor, rawQuery: unknown): Promise<CashTransactionPage> {
  assertCan(actor, "cash.manage");
  const query = parseInput(listCashTransactionsSchema, rawQuery);
  const where: Prisma.CashTransactionWhereInput = {
    type: query.type,
    status: query.status,
    occurredOn: { gte: query.from, lte: query.to },
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
  const [contractPayments, otherIncome, expense] = await Promise.all([
    sumConfirmedPayments(prisma, { paidOn: { gte: from, lte: to } }),
    repo.sumConfirmedCash(prisma, "INCOME", from, to),
    repo.sumConfirmedCash(prisma, "EXPENSE", from, to),
  ]);
  return { contractPayments, otherIncome, expense };
}

/** Records a CONFIRMED income or expense (T-015). Replays behave like payments. */
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
    const created = await prisma.$transaction(async (tx) => {
      const transaction = await repo.createCashTransaction(tx, { ...data, idempotencyKey: key.data, createdById: actor.id });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "cash_transaction",
        entityId: transaction.id,
        action: "cash_transaction.created",
        metadata: { type: data.type, category: data.category, amount: data.amount, occurredOn: data.occurredOn.toISOString().slice(0, 10) },
      });
      return transaction;
    });
    return { transaction: toView(created), replayed: false };
  } catch (error) {
    // The same request submitted twice at once: the unique key lets one through.
    if (!isUniqueViolation(error)) throw error;
    const replayAfterRace = await replayOf(key.data, data, actor);
    if (replayAfterRace) return { transaction: replayAfterRace, replayed: true };
    throw error;
  }
}

/** A-009: corrected by voiding with a reason and recording a new one. Repeating returns the current state. */
export async function voidCashTransaction(actor: Actor, id: string, input: unknown): Promise<CashTransactionView> {
  assertCan(actor, "cash.manage");
  const { reason } = parseInput(voidSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    const transaction = await repo.findCashTransaction(tx, id);
    if (!transaction) throw new AppError("NOT_FOUND");
    if (transaction.status === "VOIDED") return toView(transaction);

    if ((await repo.voidCashTransaction(tx, id, { voidedAt: new Date(), voidedById: actor.id, voidReason: reason })) === 1) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "cash_transaction",
        entityId: id,
        action: "cash_transaction.voided",
        metadata: { type: transaction.type, amount: Number(transaction.amount), reason },
      });
    }
    return toView((await repo.findCashTransaction(tx, id))!);
  });
}

async function replayOf(key: string, data: CashTransactionData, actor: Actor): Promise<CashTransactionView | null> {
  const existing = await repo.findCashTransactionByIdempotencyKey(prisma, key);
  if (!existing) return null;
  const same =
    existing.createdById === actor.id &&
    existing.type === data.type &&
    existing.category === data.category &&
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
    type: transaction.type,
    category: transaction.category,
    amount: Number(transaction.amount),
    description: transaction.description,
    reference: transaction.reference,
    occurredOn: transaction.occurredOn,
    status: transaction.status,
    createdAt: transaction.createdAt,
    createdBy: transaction.createdBy.name,
    voidedAt: transaction.voidedAt,
    voidedBy: transaction.voidedBy?.name ?? null,
    voidReason: transaction.voidReason,
  };
}
