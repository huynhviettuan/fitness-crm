import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  VOUCHER_ACTIONS,
  branchTransferInputSchema,
  cancellationEffect,
  cancellationInputSchema,
  canChangeContract,
  exchangeEffect,
  exchangeInputSchema,
  endDateAfterHold,
  holdDays,
  maxRefund,
  holdInputSchema,
  rangesOverlap,
  renewalInputSchema,
  renewalPeriod,
  transferEffect,
  transferInputSchema,
  voucherListQuerySchema,
  type ExchangeKind,
  type Voucher,
  type VoucherKind,
  type VoucherPage,
} from "@gymcrm/shared/changes";
import { effectiveStatus, entitledSessions, idempotencyKeySchema, valueOfContract } from "@gymcrm/shared/contracts";
import type { Prisma } from "../../generated/prisma/client.js";
import { ruleFor, submitForApproval } from "../../platform/approvals/approval.engine.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { hasBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { startOfGymDay } from "../bookings/booking.service.js";
import { queueContractEmail } from "../contracts/contract-email.js";
import * as contractRepo from "../contracts/contract.repository.js";
import { createCashTransactionIn } from "../finance/cash.service.js";
import { sumValidPayments } from "../finance/payment.repository.js";
import { contractsVisibleTo, gymToday } from "../contracts/contract.service.js";
import * as repo from "./voucher.repository.js";

// Contract change vouchers (M8, brief §5.6, FR-CHG-001, FR-CHG-002, D-024; A-219 to A-226). A voucher is raised against an
// approved contract, waits for approval as the matrix says (D-018), and acts only when approved: its effect is set then,
// once, and the database sums the approved ones into the contract (T-050). Raising and deciding run under the contract's
// row lock, contract first (T-036, T-040).

const DAY = 86_400_000;
const uuid = z.uuid();
const notFound = () => new AppError("NOT_FOUND");
const invalid = (field: string, code = "invalidChoice") =>
  new AppError("VALIDATION_FAILED", { fieldErrors: { [field]: [code] } });
const money = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

function toView(record: repo.VoucherRecord, pendingRequestId: string | null): Voucher {
  return {
    id: record.id,
    voucherNumber: record.voucherNumber,
    kind: record.kind,
    status: record.status,
    contract: record.contract,
    customer: {
      id: record.customer.id,
      customerCode: record.customer.customerCode ?? "",
      fullName: record.customer.fullName,
    },
    branch: record.branch,
    fromDate: record.fromDate,
    toDate: record.toDate,
    months: record.months,
    days: record.days,
    sessions: record.sessions,
    amount: money(record.amount),
    targetService: record.targetService,
    credit: money(record.credit),
    toCustomer: record.toCustomer ? { ...record.toCustomer, customerCode: record.toCustomer.customerCode ?? "" } : null,
    newContract: record.newContract,
    toBranch: record.toBranch,
    reason: record.reason ? chosen(record.reason, record.reasonNote) : null,
    valueUsed: money(record.valueUsed),
    fee: money(record.fee),
    refundVoucher: record.refundTransaction,
    note: record.note,
    sessionsDelta: record.sessionsDelta,
    valueDelta: Number(record.valueDelta),
    endDateBefore: record.endDateBefore,
    endDateAfter: record.endDateAfter,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    approvedBy: record.approvedBy,
    approvedAt: record.approvedAt,
    pendingRequestId,
  };
}

async function pendingRequestOf(db: Db, id: string): Promise<string | null> {
  const request = await db.approvalRequest.findFirst({
    where: { entityType: "voucher", entityId: id, status: "PENDING" },
    select: { id: true },
  });
  return request?.id ?? null;
}

async function viewOf(db: Db, where: Prisma.ContractChangeVoucherWhereInput): Promise<Voucher> {
  const record = await repo.findVoucher(db, where);
  if (!record) throw notFound();
  return toView(record, await pendingRequestOf(db, record.id));
}

// ------------------------------------------------------------------------------------------------------ reading

export async function listVouchers(actor: Actor, rawQuery: unknown): Promise<VoucherPage> {
  assertCan(actor, "contract.view");
  const query = parseInput(voucherListQuerySchema, rawQuery);
  const where: Prisma.ContractChangeVoucherWhereInput = {
    AND: [
      { contract: contractsVisibleTo(actor) },
      { contractId: query.contractId, customerId: query.customerId, kind: query.kind, status: query.status },
    ],
  };
  const { items, total } = await repo.listVouchers(prisma, where, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  const pending = await prisma.approvalRequest.findMany({
    where: { entityType: "voucher", entityId: { in: items.map((item) => item.id) }, status: "PENDING" },
    select: { id: true, entityId: true },
  });
  const requests = new Map(pending.map((request) => [request.entityId, request.id]));
  return {
    items: items.map((item) => toView(item, requests.get(item.id) ?? null)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getVoucher(actor: Actor, id: string): Promise<Voucher> {
  assertCan(actor, "contract.view");
  if (!uuid.safeParse(id).success) throw notFound();
  return viewOf(prisma, { AND: [{ id }, { contract: contractsVisibleTo(actor) }] });
}

// ----------------------------------------------------------------------------------------------------- raising

type Fields = Pick<
  Prisma.ContractChangeVoucherUncheckedCreateInput,
  | "fromDate"
  | "toDate"
  | "months"
  | "days"
  | "sessions"
  | "amount"
  | "note"
  | "targetServiceId"
  | "credit"
  | "toCustomerId"
  | "toBranchId"
  | "reasonOptionId"
  | "reasonNote"
  | "valueUsed"
  | "fee"
  | "refundMethodId"
  | "refundMethodNote"
  | "refundCategoryId"
  | "refundCategoryNote"
>;

type Raised = { voucher: Voucher; replayed: boolean };

function fingerprintOf(contractId: string, kind: VoucherKind, actor: Actor, data: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ contractId, kind, actorId: actor.id, data }))
    .digest("hex");
}

/**
 * Raises a voucher against a contract. A replay with the same key and content returns the first voucher; the same key with
 * other content is refused (T-015). It waits for approval when the matrix says so, else it acts at once.
 */
async function raise(
  actor: Actor,
  rawKey: unknown,
  contractId: string,
  kind: VoucherKind,
  content: unknown,
  build: (tx: Db, contract: contractRepo.ContractRecord, today: Date) => Promise<Fields>,
): Promise<Raised> {
  assertCan(actor, "contract.change");
  const key = idempotencyKeySchema.safeParse(rawKey);
  if (!key.success) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
  const fingerprint = fingerprintOf(contractId, kind, actor, content);
  const replay = async (): Promise<Raised | null> => {
    const existing = await repo.findVoucherByKey(prisma, key.data);
    if (!existing) return null;
    if (
      existing.contractId !== contractId ||
      existing.createdById !== actor.id ||
      existing.requestFingerprint !== fingerprint
    ) {
      throw new AppError("IDEMPOTENCY_KEY_REUSED");
    }
    return { voucher: toView(existing, await pendingRequestOf(prisma, existing.id)), replayed: true };
  };
  const first = await replay();
  if (first) return first;

  try {
    const id = await prisma.$transaction(async (tx) => {
      if (!(await contractRepo.lockContract(tx, contractId))) throw notFound();
      const contract = await contractRepo.findContract(tx, contractId, contractsVisibleTo(actor));
      if (!contract) throw notFound();
      const today = gymToday();
      const fields = await build(tx, contract, today);
      const created = await repo.createVoucher(tx, {
        voucherNumber: await repo.nextVoucherNumber(tx),
        kind,
        contractId: contract.id,
        branchId: contract.branchId,
        customerId: contract.customerId,
        ...fields,
        idempotencyKey: key.data,
        requestFingerprint: fingerprint,
        createdById: actor.id,
      });
      const voucher = await repo.findVoucher(tx, { id: created.id });
      if (!voucher) throw notFound();
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "contract_change_voucher",
        entityId: voucher.id,
        action: "contract_change_voucher.created",
        after: {
          voucherNumber: voucher.voucherNumber,
          kind,
          contractCode: contract.contractCode,
          fromDate: fields.fromDate ? dayText(fields.fromDate as Date) : null,
          toDate: fields.toDate ? dayText(fields.toDate as Date) : null,
          months: fields.months ?? null,
          days: fields.days ?? null,
          sessions: fields.sessions ?? null,
          amount: fields.amount === undefined || fields.amount === null ? null : Number(fields.amount),
          status: "PENDING",
        },
      });
      const rule = await ruleFor(tx, VOUCHER_ACTIONS[kind]);
      if (rule.required) {
        await submitForApproval(tx, actor, {
          action: VOUCHER_ACTIONS[kind],
          entityType: "voucher",
          entityId: voucher.id,
          branchId: contract.branchId,
          title: `${voucher.voucherNumber} · ${voucher.customer.fullName}`,
          amount: fields.amount === undefined || fields.amount === null ? null : Number(fields.amount),
        });
      } else {
        await decideVoucher(tx, actor, voucher.id, "APPROVED");
      }
      return voucher.id;
    }, LOCKING_TRANSACTION);
    return { voucher: await viewOf(prisma, { id }), replayed: false };
  } catch (error) {
    // The same request twice at once: the unique key lets one through, and the other gets its voucher.
    if (!isUniqueViolation(error)) throw error;
    const again = await replay();
    if (again) return again;
    throw error;
  }
}

const AUDIT_VERBS: Partial<Record<VoucherKind, string>> = {
  RENEWAL: "contract.renewed_by_voucher",
  HOLD: "contract.held_by_voucher",
  UPGRADE: "contract.upgraded_by_voucher",
  CONVERSION: "contract.converted_by_voucher",
  TRANSFER: "contract.transferred_by_voucher",
  BRANCH_TRANSFER: "contract.branch_transferred_by_voucher",
  CANCELLATION: "contract.cancelled_by_voucher",
};

const dayText = (day: Date) => day.toISOString().slice(0, 10);

/** A renewal adds months, days or sessions, and what is to be paid for them (brief §5.6). */
export async function raiseRenewal(actor: Actor, rawInput: unknown, idempotencyKey: unknown): Promise<Raised> {
  const input = parseInput(renewalInputSchema, rawInput);
  return raise(actor, idempotencyKey, input.contractId, "RENEWAL", input, async (_tx, contract, today) => {
    const status = effectiveStatus(contract, today);
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    // A running contract, or one that has just ended, is renewed: the others have nothing to renew (A-220).
    if (status !== "ACTIVE" && status !== "EXPIRED") throw new AppError("CONTRACT_NOT_ACTIVE");
    const period = renewalPeriod({
      endDate: contract.endDate,
      today,
      from: input.fromDate ?? null,
      months: input.months,
      days: input.days,
    });
    return {
      fromDate: period.from,
      toDate: period.to,
      months: input.months,
      days: input.days,
      sessions: input.sessions,
      amount: input.amount,
      note: input.note,
    };
  });
}

/**
 * An upgrade or a conversion exchanges what is left of the package for a new service (brief §5.6, A-227): the contract keeps
 * its code and its history; the sessions left become the new package's, and the price less the credit is added to what is owed.
 */
async function raiseExchange(
  actor: Actor,
  kind: ExchangeKind,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<Raised> {
  const input = parseInput(exchangeInputSchema, rawInput);
  return raise(actor, idempotencyKey, input.contractId, kind, input, async (tx, contract, today) => {
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if (!canChangeContract(effectiveStatus(contract, today))) throw new AppError("CONTRACT_NOT_ACTIVE");
    const service = await tx.service.findFirst({
      where: { id: input.targetServiceId, active: true, branches: { some: { branchId: contract.branchId } } },
      select: { id: true },
    });
    if (!service) throw invalid("targetServiceId");
    if (input.credit > valueOfContract(Number(contract.contractValue), Number(contract.voucherValue))) {
      throw invalid("credit", "creditAboveValue");
    }
    return {
      targetServiceId: service.id,
      sessions: input.sessions,
      amount: input.amount,
      credit: input.credit,
      note: input.note,
    };
  });
}

export const raiseUpgrade = (actor: Actor, rawInput: unknown, key: unknown) =>
  raiseExchange(actor, "UPGRADE", rawInput, key);
export const raiseConversion = (actor: Actor, rawInput: unknown, key: unknown) =>
  raiseExchange(actor, "CONVERSION", rawInput, key);

/** What is left on a contract and what is owed on it, as it stands in this transaction (A-232). */
async function standing(tx: Db, contract: contractRepo.ContractRecord) {
  const entitled = entitledSessions(contract.totalSessions, contract.bonusSessions, contract.voucherSessions);
  const remaining = entitled - contract.openingSessionsUsed - contractRepo.usedSessionsOf(contract);
  const value = valueOfContract(Number(contract.contractValue), Number(contract.voucherValue));
  const paid = Number(contract.openingPaidAmount) + (await sumValidPayments(tx, { contractId: contract.id }));
  return { remaining, value, paid, debt: Math.max(0, value - paid) };
}

/**
 * A transfer gives the sessions left to another customer (brief §5.6, A-232): it needs a running contract with sessions left
 * and nothing owed, since the debt would not move with the sessions.
 */
export async function raiseTransfer(actor: Actor, rawInput: unknown, idempotencyKey: unknown): Promise<Raised> {
  const input = parseInput(transferInputSchema, rawInput);
  return raise(actor, idempotencyKey, input.contractId, "TRANSFER", input, async (tx, contract, today) => {
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if (!canChangeContract(effectiveStatus(contract, today))) throw new AppError("CONTRACT_NOT_ACTIVE");
    if (input.toCustomerId === contract.customerId) throw invalid("toCustomerId", "sameCustomer");
    const receiver = await tx.customer.findFirst({
      where: { id: input.toCustomerId, branchId: contract.branchId },
      select: { id: true },
    });
    if (!receiver) throw invalid("toCustomerId");
    const now = await standing(tx, contract);
    if (now.remaining <= 0) throw invalid("contractId", "nothingLeft");
    if (now.debt > 0) throw invalid("contractId", "hasDebt");
    if (input.credit > now.value) throw invalid("credit", "creditAboveValue");
    return { toCustomerId: receiver.id, credit: input.credit, note: input.note };
  });
}

/** A branch transfer moves a running contract to another branch for a fee that is added to what is owed (A-235). */
export async function raiseBranchTransfer(actor: Actor, rawInput: unknown, idempotencyKey: unknown): Promise<Raised> {
  const input = parseInput(branchTransferInputSchema, rawInput);
  return raise(actor, idempotencyKey, input.contractId, "BRANCH_TRANSFER", input, async (tx, contract, today) => {
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if (!canChangeContract(effectiveStatus(contract, today))) throw new AppError("CONTRACT_NOT_ACTIVE");
    if (input.toBranchId === contract.branchId) throw invalid("toBranchId", "sameBranch");
    await assertBranchFor(tx, actor, contract, input.toBranchId);
    return { toBranchId: input.toBranchId, amount: input.fee, note: input.note };
  });
}

/**
 * A cancellation ends a running contract at the customer's request (brief §5.6, D-010, A-240): the reason, the value of the
 * sessions used, the fee kept, and the refund, which cannot be more than what was paid less those two.
 */
export async function raiseCancellation(actor: Actor, rawInput: unknown, idempotencyKey: unknown): Promise<Raised> {
  const input = parseInput(cancellationInputSchema, rawInput);
  return raise(actor, idempotencyKey, input.contractId, "CANCELLATION", input, async (tx, contract, today) => {
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if (!canChangeContract(effectiveStatus(contract, today))) throw new AppError("CONTRACT_NOT_ACTIVE");
    if ((await bookingRepo.countCheckedInBookings(tx, contract.id)) > 0) {
      throw new AppError("CONTRACT_HAS_CHECKED_IN_BOOKING");
    }
    if (
      await tx.contractChangeVoucher.count({
        where: { contractId: contract.id, kind: "CANCELLATION", status: "PENDING" },
      })
    ) {
      throw invalid("contractId", "cancellationPending");
    }
    const reason = await resolveChoice(tx, "cancelReasons", "reasonId", {
      optionId: input.reasonId,
      note: input.reasonNote,
    });
    const now = await standing(tx, contract);
    if (input.valueUsed > now.value) throw invalid("valueUsed", "valueUsedAboveValue");
    if (input.refund > maxRefund({ paid: now.paid, valueUsed: input.valueUsed, fee: input.fee })) {
      throw invalid("refund", "refundAbovePaid");
    }
    let method: { optionId: string; note: string | null } | null = null;
    let category: { optionId: string; note: string | null } | null = null;
    if (input.refund > 0) {
      method = await resolveChoice(tx, "paymentMethods", "refundMethodId", {
        optionId: input.refundMethodId!,
        note: input.refundMethodNote,
      });
      category = await resolveChoice(tx, "expenseTypes", "refundCategoryId", {
        optionId: input.refundCategoryId!,
        note: input.refundCategoryNote,
      });
    }
    return {
      reasonOptionId: reason.optionId,
      reasonNote: reason.note,
      valueUsed: input.valueUsed,
      fee: input.fee,
      amount: input.refund,
      refundMethodId: method?.optionId ?? null,
      refundMethodNote: method?.note ?? null,
      refundCategoryId: category?.optionId ?? null,
      refundCategoryNote: category?.note ?? null,
      note: input.note,
    };
  });
}

/** The branch moved to is active, the actor works there, and the service of the contract is sold there. */
async function assertBranchFor(
  tx: Db,
  actor: Pick<Actor, "branches">,
  contract: { serviceId: string | null },
  toBranchId: string,
): Promise<void> {
  const branch = await tx.branch.findFirst({ where: { id: toBranchId, active: true }, select: { id: true } });
  if (!branch || !hasBranch(actor, toBranchId)) throw invalid("toBranchId");
  if (contract.serviceId) {
    const sold = await tx.serviceBranch.findFirst({
      where: { serviceId: contract.serviceId, branchId: toBranchId },
      select: { serviceId: true },
    });
    if (!sold) throw invalid("toBranchId", "serviceNotInBranch");
  }
}

/** Cancels every session still Booked from today on, each audited (A-233, A-236); returns how many. */
async function cancelFutureBookings(
  tx: Db,
  contractId: string,
  today: Date,
  decider: Pick<Actor, "id">,
  reason: string,
  voucherNumber: string,
): Promise<number> {
  const rule = await bookingRepo.findStatusRule(tx, "CANCELLED");
  if (!rule) throw new AppError("INTERNAL_ERROR");
  const ids = await bookingRepo.cancelBookedBookingsInRange(
    tx,
    contractId,
    { from: startOfGymDay(today), to: new Date("9999-12-31T00:00:00Z") },
    rule,
    decider.id,
  );
  for (const bookingId of ids) {
    await recordAudit(tx, {
      actorUserId: decider.id,
      entityType: "booking",
      entityId: bookingId,
      action: "booking.cancelled",
      before: { status: "BOOKED" },
      after: { status: "CANCELLED" },
      context: { reason, voucherNumber, contractId },
    });
  }
  return ids.length;
}

/** A hold stops a running contract for the days asked; they are added to its end when it is approved (brief §5.6). */
export async function raiseHold(actor: Actor, rawInput: unknown, idempotencyKey: unknown): Promise<Raised> {
  const input = parseInput(holdInputSchema, rawInput);
  return raise(actor, idempotencyKey, input.contractId, "HOLD", input, async (tx, contract, today) => {
    if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
    if (!canChangeContract(effectiveStatus(contract, today))) throw new AppError("CONTRACT_NOT_ACTIVE");
    if (
      input.fromDate.getTime() < contract.startDate.getTime() ||
      input.fromDate.getTime() > contract.endDate.getTime()
    ) {
      throw invalid("fromDate", "outsideContract");
    }
    const range = { from: input.fromDate, to: input.toDate };
    if ((await repo.openHolds(tx, contract.id)).some((hold) => rangesOverlap(hold, range))) {
      throw invalid("fromDate", "overlapsHold");
    }
    // A session already trained or counted in those days cannot be held (A-222): the hold would not stop it.
    const counted = await tx.booking.count({
      where: {
        contractId: contract.id,
        consumes: true,
        scheduledStart: {
          gte: startOfGymDay(input.fromDate),
          lt: startOfGymDay(new Date(input.toDate.getTime() + DAY)),
        },
      },
    });
    if (counted > 0) throw invalid("fromDate", "hasTrainedSessions");
    return {
      fromDate: input.fromDate,
      toDate: input.toDate,
      days: holdDays(input.fromDate, input.toDate),
      note: input.note,
    };
  });
}

// ------------------------------------------------------------------------------------------------- deciding

/**
 * Approves or rejects a pending voucher, in the transaction of the decision and under the contract's lock. Approving sets
 * the effect once: the sessions and value added, and the new end date; the database sums them into the contract. The
 * contract must still be approved and running; the kind's own rules are checked again as they stand now.
 */
export async function decideVoucher(tx: Db, decider: Actor, id: string, to: "APPROVED" | "REJECTED"): Promise<void> {
  const voucher = await repo.findVoucher(tx, { id });
  if (!voucher) throw notFound();
  if (voucher.status !== "PENDING") throw new AppError("APPROVAL_NOT_PENDING");
  const now = new Date();

  if (to === "REJECTED") {
    if (!(await repo.decideVoucherRow(tx, id, { status: "REJECTED", approvedById: decider.id, approvedAt: now }))) {
      throw new AppError("APPROVAL_NOT_PENDING");
    }
    await recordAudit(tx, {
      actorUserId: decider.id,
      entityType: "contract_change_voucher",
      entityId: id,
      action: "contract_change_voucher.rejected",
      before: { status: "PENDING" },
      after: { status: "REJECTED" },
    });
    return;
  }

  const contract = await contractRepo.findContract(tx, voucher.contractId, {});
  if (!contract) throw notFound();
  const today = gymToday();
  const status = effectiveStatus(contract, today);
  if (contract.status === "FROZEN") throw new AppError("CONTRACT_FROZEN");
  if (voucher.kind === "RENEWAL" ? status !== "ACTIVE" && status !== "EXPIRED" : !canChangeContract(status)) {
    throw new AppError("CONTRACT_NOT_ACTIVE");
  }

  const endBefore = contract.endDate;
  let endAfter = endBefore;
  let sessionsDelta = 0;
  let valueDelta = 0;
  let cancelled: string[] = [];
  let cancelledCount = 0;
  let newContractId: string | null = null;
  let refundTransactionId: string | null = null;

  if (voucher.kind === "RENEWAL") {
    sessionsDelta = voucher.sessions ?? 0;
    valueDelta = Number(voucher.amount ?? 0);
    if (voucher.toDate && voucher.toDate.getTime() > endBefore.getTime()) endAfter = voucher.toDate;
  } else if (voucher.kind === "HOLD" && voucher.fromDate && voucher.toDate) {
    endAfter = endDateAfterHold(endBefore, holdDays(voucher.fromDate, voucher.toDate));
    // The sessions booked inside the hold are cancelled with it, each audited; the customer books again after (A-222).
    const rule = await bookingRepo.findStatusRule(tx, "CANCELLED");
    if (!rule) throw new AppError("INTERNAL_ERROR");
    cancelled = await bookingRepo.cancelBookedBookingsInRange(
      tx,
      contract.id,
      { from: startOfGymDay(voucher.fromDate), to: startOfGymDay(new Date(voucher.toDate.getTime() + DAY)) },
      rule,
      decider.id,
    );
    for (const bookingId of cancelled) {
      await recordAudit(tx, {
        actorUserId: decider.id,
        entityType: "booking",
        entityId: bookingId,
        action: "booking.cancelled",
        before: { status: "BOOKED" },
        after: { status: "CANCELLED" },
        context: { reason: "contract.hold", voucherNumber: voucher.voucherNumber, contractId: contract.id },
      });
    }
  } else if (voucher.kind === "UPGRADE" || voucher.kind === "CONVERSION") {
    // What is left now is exchanged for the new package, as the contract stands now (A-227, A-228).
    const entitled = entitledSessions(contract.totalSessions, contract.bonusSessions, contract.voucherSessions);
    const remaining = entitled - contract.openingSessionsUsed - contractRepo.usedSessionsOf(contract);
    const value = valueOfContract(Number(contract.contractValue), Number(contract.voucherValue));
    const credit = Number(voucher.credit ?? 0);
    if (credit > value) throw new AppError("VALIDATION_FAILED", { fieldErrors: { credit: ["creditAboveValue"] } });
    ({ sessionsDelta, valueDelta } = exchangeEffect({
      remaining,
      sessions: voucher.sessions ?? 0,
      amount: Number(voucher.amount ?? 0),
      credit,
    }));
  } else if (voucher.kind === "TRANSFER") {
    // As the contract stands now: what is left moves, and nothing may be owed (A-232, A-233).
    const now = await standing(tx, contract);
    const credit = Number(voucher.credit ?? 0);
    if (now.remaining <= 0 || !voucher.toCustomerId) throw new AppError("CONTRACT_NOT_ACTIVE");
    if (now.debt > 0) throw new AppError("VALIDATION_FAILED", { fieldErrors: { contractId: ["hasDebt"] } });
    if (credit > now.value) throw new AppError("VALIDATION_FAILED", { fieldErrors: { credit: ["creditAboveValue"] } });
    ({ sessionsDelta, valueDelta } = transferEffect({ remaining: now.remaining, credit }));
    cancelledCount = await cancelFutureBookings(
      tx,
      contract.id,
      today,
      decider,
      "contract.transfer",
      voucher.voucherNumber,
    );
    newContractId = await createTransferredContract(tx, decider, contract, voucher.toCustomerId, {
      sessions: now.remaining,
      credit,
      today,
    });
  } else if (voucher.kind === "CANCELLATION") {
    // As the contract stands now: no sessions left, nothing owed, and the refund paid out as an expense voucher (A-240).
    if ((await bookingRepo.countCheckedInBookings(tx, contract.id)) > 0) {
      throw new AppError("CONTRACT_HAS_CHECKED_IN_BOOKING");
    }
    const now = await standing(tx, contract);
    const refund = Number(voucher.amount ?? 0);
    const valueUsed = Number(voucher.valueUsed ?? 0);
    if (refund > maxRefund({ paid: now.paid, valueUsed, fee: Number(voucher.fee ?? 0) })) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { refund: ["refundAbovePaid"] } });
    }
    ({ sessionsDelta, valueDelta } = cancellationEffect({
      remaining: now.remaining,
      value: now.value,
      paid: now.paid,
    }));
    const rule = await bookingRepo.findStatusRule(tx, "CANCELLED");
    if (!rule) throw new AppError("INTERNAL_ERROR");
    const ids = await bookingRepo.cancelBookedBookingsOfContract(tx, contract.id, rule, decider.id);
    for (const bookingId of ids) {
      await recordAudit(tx, {
        actorUserId: decider.id,
        entityType: "booking",
        entityId: bookingId,
        action: "booking.cancelled",
        before: { status: "BOOKED" },
        after: { status: "CANCELLED" },
        context: { reason: "contract.cancelled", voucherNumber: voucher.voucherNumber, contractId: contract.id },
      });
    }
    cancelledCount = ids.length;
    if (refund > 0 && voucher.refundMethodId && voucher.refundCategoryId) {
      const expense = await createCashTransactionIn(
        tx,
        decider,
        {
          branchId: contract.branchId,
          type: "EXPENSE",
          methodId: voucher.refundMethodId,
          methodNote: voucher.refundMethodNote,
          payee: voucher.customer.fullName,
          contractId: contract.id,
          categoryId: voucher.refundCategoryId,
          categoryNote: voucher.refundCategoryNote,
          amount: refund,
          occurredOn: today,
          reference: voucher.voucherNumber,
          description: `Hoàn tiền hủy hợp đồng ${contract.contractCode}`,
        },
        voucher.id,
      );
      refundTransactionId = expense.id;
    }
  } else if (voucher.kind === "BRANCH_TRANSFER" && voucher.toBranchId) {
    await assertBranchFor(tx, { branches: "ALL" }, contract, voucher.toBranchId);
    valueDelta = Number(voucher.amount ?? 0);
    cancelledCount = await cancelFutureBookings(
      tx,
      contract.id,
      today,
      decider,
      "contract.branchTransfer",
      voucher.voucherNumber,
    );
  } else {
    throw new AppError("INTERNAL_ERROR");
  }

  const decided = await repo.decideVoucherRow(tx, id, {
    status: "APPROVED",
    approvedById: decider.id,
    approvedAt: now,
    sessionsDelta,
    valueDelta,
    endDateBefore: endBefore,
    endDateAfter: endAfter,
    newContractId,
    refundTransactionId,
  });
  if (!decided) throw new AppError("APPROVAL_NOT_PENDING");
  if (endAfter.getTime() !== endBefore.getTime()) await contractRepo.setEndDate(tx, contract.id, endAfter);
  if (voucher.kind === "CANCELLATION") {
    await contractRepo.moveStatus(tx, contract.id, contract.status, "CANCELLED");
  }
  // The branch moves only once the voucher is approved: the database lock checks for it (A-235).
  if (voucher.kind === "BRANCH_TRANSFER" && voucher.toBranchId) {
    await contractRepo.setBranch(tx, contract.id, voucher.toBranchId);
  }

  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "contract_change_voucher",
    entityId: id,
    action: "contract_change_voucher.approved",
    before: { status: "PENDING" },
    after: { status: "APPROVED", sessionsDelta, valueDelta, endDate: dayText(endAfter) },
  });
  // The contract's own history (the package history tab) shows what the voucher did to it.
  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "contract",
    entityId: contract.id,
    action: AUDIT_VERBS[voucher.kind] ?? "contract.held_by_voucher",
    before: { endDate: dayText(endBefore) },
    after: { endDate: dayText(endAfter) },
    context: {
      voucherNumber: voucher.voucherNumber,
      kind: voucher.kind,
      sessionsDelta,
      valueDelta,
      cancelledBookings: cancelled.length + cancelledCount,
    },
  });

  if (voucher.kind === "RENEWAL") {
    await queueContractEmail(tx, {
      event: "change.renewal",
      causeId: id,
      contractId: contract.id,
      by: decider.id,
      day: today,
      voucher: {
        voucherNumber: voucher.voucherNumber,
        sessionsAdded: sessionsDelta,
        fromDate: voucher.fromDate,
        toDate: voucher.toDate,
        amount: valueDelta,
      },
    });
  } else if (voucher.kind === "TRANSFER" && voucher.toCustomer && newContractId) {
    // Both customers are told: the giver on the old contract, the receiver on the new one (A-234).
    await queueContractEmail(tx, {
      event: "change.transferOut",
      causeId: id,
      contractId: contract.id,
      by: decider.id,
      day: today,
      voucher: {
        voucherNumber: voucher.voucherNumber,
        sessionsAdded: -sessionsDelta,
        fromDate: null,
        toDate: null,
        amount: null,
        otherParty: voucher.toCustomer.fullName,
      },
    });
    await queueContractEmail(tx, {
      event: "change.transferIn",
      causeId: id,
      contractId: newContractId,
      by: decider.id,
      day: today,
      voucher: {
        voucherNumber: voucher.voucherNumber,
        sessionsAdded: -sessionsDelta,
        fromDate: null,
        toDate: null,
        amount: null,
        otherParty: voucher.customer.fullName,
      },
    });
  } else if (voucher.kind === "CANCELLATION") {
    await queueContractEmail(tx, {
      event: "contract.cancelled",
      causeId: id,
      contractId: contract.id,
      by: decider.id,
      day: today,
    });
  } else if (voucher.kind === "BRANCH_TRANSFER" && voucher.toBranch) {
    await queueContractEmail(tx, {
      event: "change.branchTransfer",
      causeId: id,
      contractId: contract.id,
      by: decider.id,
      day: today,
      voucher: {
        voucherNumber: voucher.voucherNumber,
        sessionsAdded: 0,
        fromDate: null,
        toDate: null,
        amount: valueDelta,
        targetBranch: voucher.toBranch.name,
      },
    });
  } else if (voucher.kind === "UPGRADE" || voucher.kind === "CONVERSION") {
    await queueContractEmail(tx, {
      event: voucher.kind === "UPGRADE" ? "change.upgrade" : "change.conversion",
      causeId: id,
      contractId: contract.id,
      by: decider.id,
      day: today,
      voucher: {
        voucherNumber: voucher.voucherNumber,
        sessionsAdded: sessionsDelta,
        fromDate: null,
        toDate: null,
        amount: valueDelta,
        targetService: voucher.targetService?.name ?? "",
      },
    });
  } else {
    await queueContractEmail(tx, {
      event: "change.hold",
      causeId: id,
      contractId: contract.id,
      by: decider.id,
      day: today,
      addedDays: Math.round((endAfter.getTime() - endBefore.getTime()) / DAY),
      voucher: {
        voucherNumber: voucher.voucherNumber,
        sessionsAdded: 0,
        fromDate: voucher.fromDate,
        toDate: voucher.toDate,
        amount: null,
      },
    });
  }
}

/**
 * The contract the receiver of a transfer gets (A-232): the sessions left, worth the credit that went with them and already
 * paid, with the service, the validity end and the staff shares of the contract given away. It is approved at once, by the
 * decision of the voucher, and its type says where it came from.
 */
async function createTransferredContract(
  tx: Db,
  decider: Pick<Actor, "id">,
  from: contractRepo.ContractRecord,
  toCustomerId: string,
  moved: { sessions: number; credit: number; today: Date },
): Promise<string> {
  const row = await tx.contract.findUniqueOrThrow({ where: { id: from.id } });
  const shares = await tx.contractStaffShare.findMany({ where: { contractId: from.id } });
  const created = await contractRepo.createContract(
    tx,
    {
      customerId: toCustomerId,
      branchId: row.branchId,
      contractCode: await contractRepo.nextContractCode(tx),
      idempotencyKey: randomUUID(),
      createdById: decider.id,
      packageName: row.packageName,
      serviceId: row.serviceId,
      priceTierId: row.priceTierId,
      contractType: "TRANSFER",
      previousContractId: row.id,
      contractDate: moved.today,
      contractValue: moved.credit,
      totalSessions: moved.sessions,
      openingPaidAmount: moved.credit,
      startDate: moved.today,
      endDate: row.endDate,
      tierUnitPrice: row.tierUnitPrice,
      approvedUnitPrice: row.approvedUnitPrice,
      isExceptionPrice: row.isExceptionPrice,
      exceptionReasonId: row.exceptionReasonId,
      exceptionNote: row.exceptionNote,
      isImported: row.isImported,
    },
    shares.map((share) => ({ role: share.role, employeeId: share.employeeId, percent: Number(share.percent) })),
    [],
  );
  if ((await contractRepo.approve(tx, created.id, decider.id, new Date())) !== 1) throw new AppError("INTERNAL_ERROR");
  await recordAudit(tx, {
    actorUserId: decider.id,
    entityType: "contract",
    entityId: created.id,
    action: "contract.created_by_transfer",
    after: {
      contractCode: created.contractCode,
      sessions: moved.sessions,
      value: moved.credit,
      from: from.contractCode,
    },
  });
  return created.id;
}

/** The contract a pending voucher acts on, locked first when the decision runs (T-040). */
export async function lockVoucherContract(tx: Db, voucherId: string): Promise<void> {
  const voucher = await tx.contractChangeVoucher.findUnique({ where: { id: voucherId }, select: { contractId: true } });
  if (voucher) await contractRepo.lockContract(tx, voucher.contractId);
}
