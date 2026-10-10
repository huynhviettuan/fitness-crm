import type { Db } from "@/lib/db/prisma";
import type { ContractStatus, Prisma } from "@/generated/prisma/client";
import { normalizeForSearch } from "@flow/shared/validation";
import { formatContractCode } from "@flow/shared/contracts";
import type { ContractData } from "@flow/shared/contracts";

const withCustomer = {
  customer: { select: { id: true, customerCode: true, fullName: true } },
  // T-012: completed sessions are the contract's bookings in COMPLETED.
  _count: { select: { bookings: { where: { status: "COMPLETED" } } } },
} as const satisfies Prisma.ContractInclude;

export type ContractRecord = Prisma.ContractGetPayload<{ include: typeof withCustomer }>;

/**
 * Locks the contract row until the transaction ends (docs/22 §7, T-013). Every change
 * to a contract's bookings takes this lock first, so they run one at a time per
 * contract. Returns false when the contract does not exist.
 */
export async function lockContract(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM contracts WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

/** Draws the next code from the sequence; concurrent callers never get the same value. */
export async function nextContractCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('contract_code_seq') AS value`;
  return formatContractCode(row.value);
}

export function createContract(
  db: Db,
  data: ContractData & { customerId: string; contractCode: string; idempotencyKey: string; createdById: string },
): Promise<ContractRecord> {
  return db.contract.create({ data, include: withCustomer });
}

export function findContract(db: Db, id: string, visibility: Prisma.ContractWhereInput): Promise<ContractRecord | null> {
  return db.contract.findFirst({ where: { AND: [{ id }, visibility] }, include: withCustomer });
}

export function findContracts(db: Db, ids: string[], visibility: Prisma.ContractWhereInput): Promise<ContractRecord[]> {
  return db.contract.findMany({ where: { AND: [{ id: { in: ids } }, visibility] }, include: withCustomer });
}

export function findContractByIdempotencyKey(db: Db, idempotencyKey: string): Promise<ContractRecord | null> {
  return db.contract.findUnique({ where: { idempotencyKey }, include: withCustomer });
}

/** Changes the entered fields only while the contract is still a draft. Returns rows changed. */
export async function updateDraft(db: Db, id: string, data: ContractData): Promise<number> {
  const { count } = await db.contract.updateMany({ where: { id, status: "DRAFT" }, data });
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
      include: withCustomer,
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
