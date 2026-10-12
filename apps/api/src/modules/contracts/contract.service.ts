import { createHash } from "node:crypto";
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
import { chosen, resolveChoice } from "../../platform/options/option.service.js";
import { ownCustomers, visibleTo as customersVisibleTo } from "../customers/customer.service.js";
import { findCustomer } from "../customers/customer.repository.js";
import * as bookingRepo from "../bookings/booking.repository.js";
import { recordPaymentIn } from "../finance/payment.service.js";
import { validPaidByContract } from "../finance/payment.repository.js";
import { canApproveDiscount, discountOfOffer, resolveOffers } from "../promotions/promotion.service.js";
import { onSaleIn, priceAt } from "../services/service.service.js";
import * as repo from "./contract.repository.js";
import {
  canActivate,
  canCancel,
  contractEndDate,
  contractFigures,
  contractInputSchema,
  contractStaffQuerySchema,
  effectiveStatus,
  entitledSessions,
  idempotencyKeySchema,
  isEditable,
  listContractsSchema,
  ptSharesRequired,
  sharesProblems,
  type Contract as ContractView,
  type ContractStaff,
  type ContractData,
  type Share,
} from "@flow/shared/contracts";
import { displayNameOf } from "@flow/shared/services";
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
      return contract.id;
    }, LOCKING_TRANSACTION);
    return {
      contract: await presentOne(prisma, await getOrThrow(prisma, actor, created), gymToday()),
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
    // Activating is the contract's approval until M4.4: never by its creator (D-018).
    if (before.createdById === actor.id) throw new AppError("APPROVAL_OWN_REQUEST");
    // A discount above what the approver's role may approve itself needs a role with a higher limit (A-112).
    if (!(await canApproveDiscount(tx, actor, discountPercentOfRecord(before)))) {
      throw new AppError("DISCOUNT_ABOVE_LIMIT");
    }

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
  return { AND: [inBranches(actor), isOwnOnly(actor, "contracts") ? own : {}] };
}
