import type { Db } from "../../platform/db/prisma.js";
import type { ContractStatus, Prisma } from "../../generated/prisma/client.js";
import { normalizeForSearch } from "@flow/shared/validation";
import { formatContractCode, type Share } from "@flow/shared/contracts";
import type { ChosenOption } from "@flow/shared/options";
import { chosen, chosenSelect } from "../../platform/options/option.service.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";

const withRefs = {
  customer: { select: { id: true, customerCode: true, fullName: true } },
  // T-012: completed sessions are the contract's bookings in COMPLETED.
  _count: { select: { bookings: { where: { status: "COMPLETED" } } } },
  service: { select: { id: true, name: true, kind: true } },
  previousContract: { select: { id: true, contractCode: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  exceptionReason: { select: chosenSelect },
  promotion: { select: { id: true, name: true } },
  voucher: { select: { id: true, name: true } },
  shares: {
    select: { role: true, percent: true, employee: { select: { id: true, employeeCode: true, fullName: true } } },
    orderBy: [{ role: "asc" }, { employee: { fullName: "asc" } }],
  },
  companions: {
    select: { customer: { select: { id: true, customerCode: true, fullName: true } } },
    orderBy: { customer: { fullName: "asc" } },
  },
} as const satisfies Prisma.ContractInclude;

export type ContractRecord = Prisma.ContractGetPayload<{ include: typeof withRefs }>;

/**
 * Locks the contract row until the transaction ends (docs/22 §7, T-013). Every change
 * to a contract's bookings takes this lock first, so they run one at a time per
 * contract. Returns false when the contract does not exist.
 */
export async function lockContract(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM contracts WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

/**
 * Draws the next code from the sequence; concurrent callers never get the same value.
 * The prefix is configuration (D-038); the number never repeats, whatever the prefix.
 */
export async function nextContractCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('contract_code_seq') AS value`;
  return formatContractCode(await readParameter(db, "contractCodePrefix"), row.value);
}

/** Everything a contract stores that is computed by the API or entered by staff, shares and companions apart. */
export type ContractWrite = Omit<
  Prisma.ContractUncheckedCreateInput,
  "id" | "contractCode" | "customerId" | "branchId" | "idempotencyKey" | "createdById" | "shares" | "companions"
>;

export async function createContract(
  db: Db,
  data: ContractWrite & {
    customerId: string;
    branchId: string;
    contractCode: string;
    idempotencyKey: string;
    createdById: string;
  },
  shares: (Share & { role: "PT" | "SALE" })[],
  companionIds: string[],
): Promise<ContractRecord> {
  const created = await db.contract.create({ data, select: { id: true } });
  await replaceShares(db, created.id, shares);
  await replaceCompanions(db, created.id, companionIds);
  return db.contract.findUniqueOrThrow({ where: { id: created.id }, include: withRefs });
}

export function findContract(
  db: Db,
  id: string,
  visibility: Prisma.ContractWhereInput,
): Promise<ContractRecord | null> {
  return db.contract.findFirst({ where: { AND: [{ id }, visibility] }, include: withRefs });
}

export function findContracts(db: Db, ids: string[], visibility: Prisma.ContractWhereInput): Promise<ContractRecord[]> {
  return db.contract.findMany({ where: { AND: [{ id: { in: ids } }, visibility] }, include: withRefs });
}

export function findContractByIdempotencyKey(db: Db, idempotencyKey: string): Promise<ContractRecord | null> {
  return db.contract.findUnique({ where: { idempotencyKey }, include: withRefs });
}

/** Changes the entered fields only while the contract is still a draft. Returns rows changed. */
export async function updateDraft(
  db: Db,
  id: string,
  data: ContractWrite,
  shares: (Share & { role: "PT" | "SALE" })[],
  companionIds: string[],
): Promise<number> {
  const { count } = await db.contract.updateMany({ where: { id, status: "DRAFT" }, data });
  if (count === 1) {
    await replaceShares(db, id, shares);
    await replaceCompanions(db, id, companionIds);
  }
  return count;
}

async function replaceShares(db: Db, contractId: string, shares: (Share & { role: "PT" | "SALE" })[]): Promise<void> {
  await db.contractStaffShare.deleteMany({ where: { contractId } });
  await db.contractStaffShare.createMany({
    data: shares.map((share) => ({
      contractId,
      role: share.role,
      employeeId: share.employeeId,
      percent: share.percent,
    })),
  });
}

async function replaceCompanions(db: Db, contractId: string, customerIds: string[]): Promise<void> {
  await db.contractCompanion.deleteMany({ where: { contractId } });
  await db.contractCompanion.createMany({ data: customerIds.map((customerId) => ({ contractId, customerId })) });
}

/** Approval (A-121): pending to active, with who and when, only if it is still pending. Returns rows changed. */
export async function approve(db: Db, id: string, approverId: string, at: Date): Promise<number> {
  const { count } = await db.contract.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "ACTIVE", approvedById: approverId, approvedAt: at },
  });
  return count;
}

/** Unapproval (A-124): active back to pending, forgetting the approval, only if it is still active. */
export async function unapprove(db: Db, id: string): Promise<number> {
  const { count } = await db.contract.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "DRAFT", approvedById: null, approvedAt: null },
  });
  return count;
}

export type ApprovalState = {
  pending: boolean;
  rejected: { by: { id: string; name: string }; at: Date; reason: ChosenOption } | null;
};

/** Where each contract stands with the approvers: a waiting request, and the latest rejection (A-121). */
export async function approvalsOf(db: Db, ids: string[]): Promise<Map<string, ApprovalState>> {
  const rows = await db.approvalRequest.findMany({
    where: { actionType: "contract.create", entityId: { in: ids }, status: { in: ["PENDING", "REJECTED"] } },
    select: {
      entityId: true,
      status: true,
      decidedAt: true,
      decidedBy: { select: { id: true, name: true } },
      rejectReason: { select: chosenSelect },
      rejectReasonNote: true,
    },
    orderBy: { submittedAt: "desc" },
  });
  const states = new Map<string, ApprovalState>();
  for (const row of rows) {
    const state = states.get(row.entityId) ?? { pending: false, rejected: null };
    if (row.status === "PENDING") state.pending = true;
    else if (!state.rejected && row.decidedBy && row.decidedAt && row.rejectReason) {
      state.rejected = {
        by: row.decidedBy,
        at: row.decidedAt,
        reason: chosen(row.rejectReason, row.rejectReasonNote),
      };
    }
    states.set(row.entityId, state);
  }
  return states;
}

/** What blocks deleting a contract (A-125): its receipts that count or may count, and its recorded sessions. */
export async function findDependents(db: Db, contractId: string) {
  const [payments, bookings] = await Promise.all([
    db.payment.findMany({
      where: { contractId, deletedAt: null, approvalStatus: { not: "REJECTED" } },
      select: { id: true, amount: true, paidOn: true },
      orderBy: { paidOn: "asc" },
      take: 20,
    }),
    db.booking.findMany({
      where: { contractId, status: { not: "CANCELLED" } },
      select: { id: true, scheduledStart: true, status: true },
      orderBy: { scheduledStart: "asc" },
      take: 20,
    }),
  ]);
  return { payments, bookings };
}

/** Marks the contract deleted (A-125); the caller has written the trash entry. Returns rows changed. */
export async function markDeleted(
  db: Db,
  id: string,
  data: { deletedAt: Date; deletedById: string; deleteReasonId: string; deleteReasonNote: string | null },
): Promise<number> {
  const { count } = await db.contract.updateMany({ where: { id, deletedAt: null }, data });
  return count;
}

/** Moves the status only if it is still `from`, so concurrent requests cannot both win. */
export async function moveStatus(db: Db, id: string, from: ContractStatus, to: ContractStatus): Promise<number> {
  const { count } = await db.contract.updateMany({ where: { id, status: from }, data: { status: to } });
  return count;
}

export async function listContracts(
  db: Db,
  query: { q: string; customerId?: string; page: number; pageSize: number },
  visibility: Prisma.ContractWhereInput,
) {
  const where: Prisma.ContractWhereInput = {
    AND: [visibility, query.customerId ? { customerId: query.customerId } : {}, searchWhere(query.q)],
  };
  const [items, total] = await Promise.all([
    db.contract.findMany({
      where,
      include: withRefs,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.contract.count({ where }),
  ]);
  return { items, total };
}

// Contract code, package, or the customer's code or name (accent-insensitive).
function searchWhere(q: string): Prisma.ContractWhereInput {
  const term = q.trim();
  if (term === "") return {};
  return {
    OR: [
      { contractCode: { contains: term, mode: "insensitive" } },
      { packageName: { contains: term, mode: "insensitive" } },
      { customer: { customerCode: { contains: term, mode: "insensitive" } } },
      { customer: { searchName: { contains: normalizeForSearch(term) } } },
    ],
  };
}

/** The employees named in the shares, with what decides whether they may be named (A-115). */
export function findEmployees(db: Db, ids: string[]) {
  return db.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, branchId: true, status: true, isTrainer: true },
  });
}

/** Active employees of a branch, for the shares of a contract (A-115). */
export function listBranchStaff(db: Db, branchId: string) {
  return db.employee.findMany({
    where: { branchId, status: "ACTIVE" },
    select: { id: true, employeeCode: true, fullName: true, isTrainer: true },
    orderBy: { fullName: "asc" },
  });
}

/** The customers named as companions (A-116). */
export function findCompanionCandidates(db: Db, ids: string[], visibility: Prisma.CustomerWhereInput) {
  return db.customer.findMany({
    where: { AND: [{ id: { in: ids }, stage: "CUSTOMER" }, visibility] },
    select: { id: true, branchId: true },
  });
}

/** A renewal follows an earlier contract of the same customer. */
export function findContractOfCustomer(db: Db, id: string, customerId: string) {
  return db.contract.findFirst({ where: { id, customerId }, select: { id: true } });
}
