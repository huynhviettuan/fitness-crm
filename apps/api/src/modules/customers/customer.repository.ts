import type { Db } from "../../platform/db/prisma.js";
import type { CustomerStatus, Prisma } from "../../generated/prisma/client.js";
import { normalizeForSearch, normalizePhone } from "@flow/shared/validation";
import { formatCustomerCode } from "@flow/shared/customers";
import { readParameter } from "../../platform/parameters/parameter.service.js";

const withBranch = { branch: { select: { id: true, name: true } } } as const;

export type CustomerRecord = Prisma.CustomerGetPayload<{ include: typeof withBranch }>;

export type CustomerWrite = {
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: Date | null;
  notes: string | null;
  status?: CustomerStatus;
};

/**
 * Draws the next code from the sequence; concurrent callers never get the same value.
 * The prefix is configuration (D-038); the number never repeats, whatever the prefix.
 */
export async function nextCustomerCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('customer_code_seq') AS value`;
  return formatCustomerCode(await readParameter(db, "customerCodePrefix"), row.value);
}

export function createCustomer(db: Db, customerCode: string, data: CustomerWrite & { branchId: string; createdById: string }) {
  return db.customer.create({
    data: { ...data, customerCode, searchName: normalizeForSearch(data.fullName) },
    include: withBranch,
  });
}

export function updateCustomer(db: Db, id: string, data: Partial<CustomerWrite>) {
  return db.customer.update({
    where: { id },
    data: {
      ...data,
      ...(data.fullName !== undefined && { searchName: normalizeForSearch(data.fullName) }),
    },
    include: withBranch,
  });
}

export function findCustomer(db: Db, id: string, visibility: Prisma.CustomerWhereInput) {
  return db.customer.findFirst({ where: { AND: [{ id }, visibility] }, include: withBranch });
}

export async function listCustomers(
  db: Db,
  query: { q: string; page: number; pageSize: number },
  visibility: Prisma.CustomerWhereInput,
  searchPhone: boolean,
) {
  const where: Prisma.CustomerWhereInput = { AND: [visibility, searchWhere(query.q, searchPhone)] };
  const [items, total] = await Promise.all([
    db.customer.findMany({
      where,
      include: withBranch,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.customer.count({ where }),
  ]);
  return { items, total };
}

// FR-CUS-002: search by code, name (ignoring Vietnamese accents), or phone, unless the
// phone is hidden from the user (D-017).
function searchWhere(q: string, searchPhone: boolean): Prisma.CustomerWhereInput {
  const term = q.trim();
  if (term === "") return {};

  const phoneTerm = normalizePhone(term);
  return {
    OR: [
      { customerCode: { contains: term, mode: "insensitive" } },
      { searchName: { contains: normalizeForSearch(term) } },
      ...(searchPhone && /^\+?\d+$/.test(phoneTerm) ? [{ phone: { contains: phoneTerm } }] : []),
    ],
  };
}
