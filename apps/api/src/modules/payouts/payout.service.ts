import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { idempotencyKeySchema } from "@gymcrm/shared/contracts";
import type { RecordApprovalStatus } from "@gymcrm/shared/approvals";
import { adjustmentFor, distributeAmount, ptPayoutInputSchema, ptPayoutListQuerySchema } from "@gymcrm/shared/payouts";
import type { PtPayout, PtPayoutDetail, PtPayoutPage } from "@gymcrm/shared/payouts";
import { allocationValueOf, entitledSessions, ptAllocation } from "@gymcrm/shared/reports";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { prisma } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { assertCan, forbidden } from "../../platform/permissions/assert.js";
import { hasBranch, inBranches, isMasked } from "../../platform/permissions/scope.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { parseInput } from "../../platform/validation/parse.js";
import { createCashTransactionIn } from "../finance/cash.service.js";
import { assertWholeScope, branchesOf, periodOf } from "../reports/report-scope.js";
import * as repo from "./payout.repository.js";

// PT payouts (M5.7, brief §6.3, §8.1; D-018, D-027, D-032; FR-CASH-003; A-173 to A-176).

const dateText = (day: Date) => day.toISOString().slice(0, 10).split("-").reverse().join("/");

function toView(record: repo.PayoutRecord): PtPayout {
  const status: string = record.cashTransaction.approvalStatus;
  return {
    id: record.id,
    number: record.cashTransaction.number,
    branch: record.branch,
    trainer: record.trainer,
    periodFrom: record.periodFrom,
    periodTo: record.periodTo,
    amount: Number(record.amount),
    sessionAmount: Number(record.sessionAmount),
    adjustmentAmount: Number(record.adjustmentAmount),
    sessionCount: record.sessionCount,
    adjustmentCount: record.adjustmentCount,
    approvalStatus: status as RecordApprovalStatus,
    void: record.cashTransaction.deletedAt !== null || status === "REJECTED" || status === "CANCELLED",
    createdAt: record.createdAt,
    createdBy: record.createdBy.name,
  };
}

function toDetail(record: repo.PayoutDetailRecord): PtPayoutDetail {
  return {
    ...toView(record),
    lines: record.lines.map((line) => ({
      id: line.id,
      kind: line.kind as "SESSION" | "ADJUSTMENT",
      amount: Number(line.amount),
      released: line.releasedAt !== null,
      booking: { id: line.booking.id, scheduledStart: line.booking.scheduledStart },
      customer: line.booking.customer as { id: string; customerCode: string; fullName: string },
      contract: line.contract,
    })),
  };
}

function visibleTo(actor: Actor): Prisma.PtPayoutWhereInput {
  return inBranches(actor);
}

/** Refuses what a payout must never be done from: a partial view of the records, or hidden money (D-017). */
function assertPayoutScope(actor: Actor, permission: "payout.view" | "payout.create"): void {
  assertCan(actor, permission);
  assertWholeScope(actor, "schedule", permission);
  assertWholeScope(actor, "vouchers", permission);
  if (isMasked(actor, "receipts.totals")) throw forbidden(actor, permission, "maskedMoney");
}

export async function listPayouts(actor: Actor, rawQuery: unknown): Promise<PtPayoutPage> {
  assertPayoutScope(actor, "payout.view");
  const query = parseInput(ptPayoutListQuerySchema, rawQuery);
  const where: Prisma.PtPayoutWhereInput = {
    AND: [
      visibleTo(actor),
      {
        trainerId: query.trainerId,
        periodTo: { gte: query.from },
        periodFrom: { lte: query.to },
      },
    ],
  };
  const { items, total } = await repo.listPayouts(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items: items.map(toView), total, page: query.page, pageSize: query.pageSize };
}

export async function getPayout(actor: Actor, id: string): Promise<PtPayoutDetail> {
  assertPayoutScope(actor, "payout.view");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const record = await repo.findPayout(prisma, { AND: [{ id }, visibleTo(actor)] });
  if (!record) throw new AppError("NOT_FOUND");
  return toDetail(record);
}

/**
 * Pays a PT for a period of the allocation report (FR-CASH-003, D-032): the sessions that credit the PT in the period
 * and that no standing payout has paid, at their share of the allocation, less the paid sessions deleted from the
 * history since (D-027). It makes one expense voucher, in the same transaction, and records the sessions it paid, so a
 * session is never paid twice (INT-011): payouts of one PT take turns on the PT's row, and the database allows one live
 * line per session. The amount is never typed. The voucher follows the approval matrix; a pending payout already holds
 * its sessions (D-018), and one whose voucher is deleted or rejected lets them go (the trigger of the migration).
 */
export async function createPayout(
  actor: Actor,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<{ payout: PtPayoutDetail; replayed: boolean }> {
  assertPayoutScope(actor, "payout.create");
  const key = idempotencyKeySchema.safeParse(idempotencyKey);
  if (!key.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const input = parseInput(ptPayoutInputSchema, rawInput);
  const { from, to } = periodOf(input);

  const replay = await replayOf(key.data, actor, input.trainerId, from, to);
  if (replay) return { payout: replay, replayed: true };

  try {
    const id = await prisma.$transaction(async (tx) => {
      const trainer = await repo.lockTrainer(tx, input.trainerId);
      if (!trainer || !hasBranch(actor, trainer.branchId)) {
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { trainerId: ["invalidChoice"] } });
      }
      // The choices are checked first, so a wrong category is a mistake even when there is nothing to pay.
      const category = await resolveChoice(tx, "expenseTypes", "categoryId", {
        optionId: input.categoryId,
        note: input.categoryNote,
      });
      await resolveChoice(tx, "paymentMethods", "methodId", { optionId: input.methodId, note: input.methodNote });
      const branches = branchesOf(actor, undefined);
      const timesheetRate = Number(await readParameter(tx, "ptTimesheetRate"));
      const sessions = await repo.payableSessions(tx, branches, { from, to }, env.GYM_TIMEZONE, trainer.id);

      // Each contract's sessions are paid its share of the allocation, split to the dong across them.
      const lines: repo.NewLine[] = [];
      const byContract = new Map<string, repo.PayableSession[]>();
      for (const session of sessions) {
        byContract.set(session.contractId, [...(byContract.get(session.contractId) ?? []), session]);
      }
      for (const [contractId, group] of byContract) {
        const first = group[0]!;
        const total = ptAllocation({
          credited: group.length,
          allocationValue: allocationValueOf(first.contractValue, first.vatAmount),
          sessions: entitledSessions(first.totalSessions, first.bonusSessions),
          commissionRate: first.commissionRate,
          timesheetRate,
        });
        const parts = distributeAmount(total, group.length);
        group.forEach((session, index) =>
          lines.push({ bookingId: session.bookingId, contractId, kind: "SESSION", amount: parts[index]! }),
        );
      }
      const sessionAmount = lines.reduce((sum, line) => sum + line.amount, 0);
      const adjustments = await repo.pendingAdjustments(tx, branches, trainer.id);
      for (const adjustment of adjustments) {
        lines.push({
          bookingId: adjustment.bookingId,
          contractId: adjustment.contractId,
          kind: "ADJUSTMENT",
          amount: adjustmentFor(adjustment.paid),
        });
      }
      const adjustmentAmount = lines
        .filter((line) => line.kind === "ADJUSTMENT")
        .reduce((sum, line) => sum + line.amount, 0);
      const amount = sessionAmount + adjustmentAmount;
      if (amount <= 0) throw new AppError("PAYOUT_NOTHING_TO_PAY");

      const voucher = await createCashTransactionIn(
        tx,
        actor,
        {
          branchId: trainer.branchId,
          type: "EXPENSE",
          methodId: input.methodId,
          methodNote: input.methodNote,
          payee: trainer.fullName,
          contractId: null,
          categoryId: category.optionId,
          categoryNote: category.note,
          amount,
          occurredOn: calendarDateInTimeZone(env.GYM_TIMEZONE),
          reference: null,
          description: `PT ${trainer.employeeCode} ${dateText(from)}–${dateText(to)}`,
        },
        key.data,
      );
      const payoutId = await repo.createPayout(
        tx,
        {
          branchId: trainer.branchId,
          trainerId: trainer.id,
          periodFrom: from,
          periodTo: to,
          amount,
          sessionAmount,
          adjustmentAmount,
          sessionCount: lines.length - adjustments.length,
          adjustmentCount: adjustments.length,
          cashTransactionId: voucher.id,
          idempotencyKey: key.data,
          createdById: actor.id,
        },
        lines,
      );
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "pt_payout",
        entityId: payoutId,
        action: "pt_payout.created",
        after: {
          number: voucher.number,
          trainerId: trainer.id,
          periodFrom: dateText(from),
          periodTo: dateText(to),
          amount,
          sessionAmount,
          adjustmentAmount,
          sessions: lines.length - adjustments.length,
          adjustments: adjustments.length,
          approvalStatus: voucher.approvalStatus,
        },
      });
      return payoutId;
    });
    return { payout: await getPayout(actor, id), replayed: false };
  } catch (error) {
    // The same request twice at once: the unique key lets one through.
    if (!isUniqueViolation(error)) throw error;
    const again = await replayOf(key.data, actor, input.trainerId, from, to);
    if (again) return { payout: again, replayed: true };
    throw error;
  }
}

async function replayOf(
  key: string,
  actor: Actor,
  trainerId: string,
  from: Date,
  to: Date,
): Promise<PtPayoutDetail | null> {
  const existing = await repo.findPayoutByKey(prisma, key);
  if (!existing) return null;
  const same =
    existing.createdById === actor.id &&
    existing.trainerId === trainerId &&
    existing.periodFrom.getTime() === from.getTime() &&
    existing.periodTo.getTime() === to.getTime();
  if (!same) throw new AppError("IDEMPOTENCY_KEY_REUSED");
  return getPayout(actor, existing.id);
}
