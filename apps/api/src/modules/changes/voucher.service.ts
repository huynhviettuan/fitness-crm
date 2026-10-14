import { createHash } from "node:crypto";
import { z } from "zod";
import {
  VOUCHER_ACTIONS,
  canChangeContract,
  endDateAfterHold,
  holdDays,
  holdInputSchema,
  rangesOverlap,
  renewalInputSchema,
  renewalPeriod,
  voucherListQuerySchema,
  type Voucher,
  type VoucherKind,
  type VoucherPage,
} from "@flow/shared/changes";
import { effectiveStatus, idempotencyKeySchema } from "@flow/shared/contracts";
import type { Prisma } from "../../generated/prisma/client.js";
import { ruleFor, submitForApproval } from "../../platform/approvals/approval.engine.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { startOfGymDay } from "../bookings/booking.service.js";
import { queueContractEmail } from "../contracts/contract-email.js";
import * as contractRepo from "../contracts/contract.repository.js";
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
    reason: null,
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
  "fromDate" | "toDate" | "months" | "days" | "sessions" | "amount" | "note"
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
export async function decideVoucher(
  tx: Db,
  decider: Pick<Actor, "id">,
  id: string,
  to: "APPROVED" | "REJECTED",
): Promise<void> {
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
  });
  if (!decided) throw new AppError("APPROVAL_NOT_PENDING");
  if (endAfter.getTime() !== endBefore.getTime()) await contractRepo.setEndDate(tx, contract.id, endAfter);

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
    action: voucher.kind === "RENEWAL" ? "contract.renewed_by_voucher" : "contract.held_by_voucher",
    before: { endDate: dayText(endBefore) },
    after: { endDate: dayText(endAfter) },
    context: {
      voucherNumber: voucher.voucherNumber,
      kind: voucher.kind,
      sessionsDelta,
      valueDelta,
      cancelledBookings: cancelled.length,
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

/** The contract a pending voucher acts on, locked first when the decision runs (T-040). */
export async function lockVoucherContract(tx: Db, voucherId: string): Promise<void> {
  const voucher = await tx.contractChangeVoucher.findUnique({ where: { id: voucherId }, select: { contractId: true } });
  if (voucher) await contractRepo.lockContract(tx, voucher.contractId);
}
