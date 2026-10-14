import { formatCode } from "@flow/shared/parameters";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../platform/db/prisma.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";

// Contract change vouchers (M8, brief §5.6): one table for every kind.

const include = {
  contract: { select: { id: true, contractCode: true } },
  customer: { select: { id: true, customerCode: true, fullName: true } },
  branch: { select: { id: true, name: true } },
  targetService: { select: { id: true, name: true } },
  toCustomer: { select: { id: true, customerCode: true, fullName: true } },
  newContract: { select: { id: true, contractCode: true } },
  toBranch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.ContractChangeVoucherInclude;

export type VoucherRecord = Prisma.ContractChangeVoucherGetPayload<{ include: typeof include }>;

/** The next voucher number: from the sequence, so two callers never share one and a number is never given again (D-038). */
export async function nextVoucherNumber(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('voucher_seq') AS value`;
  return formatCode(await readParameter(db, "changeCodePrefix"), row.value, 6);
}

export function findVoucher(db: Db, where: Prisma.ContractChangeVoucherWhereInput) {
  return db.contractChangeVoucher.findFirst({ where, include });
}

export function findVoucherByKey(db: Db, idempotencyKey: string) {
  return db.contractChangeVoucher.findUnique({ where: { idempotencyKey }, include });
}

export async function listVouchers(
  db: Db,
  where: Prisma.ContractChangeVoucherWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: VoucherRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.contractChangeVoucher.findMany({
      where,
      include,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    db.contractChangeVoucher.count({ where }),
  ]);
  return { items, total };
}

export function createVoucher(db: Db, data: Prisma.ContractChangeVoucherUncheckedCreateInput) {
  return db.contractChangeVoucher.create({ data, select: { id: true } });
}

/** Moves a pending voucher to its decision; false when someone decided it first. */
export async function decideVoucherRow(
  db: Db,
  id: string,
  data: Prisma.ContractChangeVoucherUncheckedUpdateManyInput,
): Promise<boolean> {
  const { count } = await db.contractChangeVoucher.updateMany({ where: { id, status: "PENDING" }, data });
  return count > 0;
}

/** The days an approved hold covers on the contract, as ranges (M8.1). */
export async function approvedHolds(db: Db, contractId: string): Promise<{ from: Date; to: Date }[]> {
  const holds = await db.contractChangeVoucher.findMany({
    where: { contractId, kind: "HOLD", status: "APPROVED" },
    select: { fromDate: true, toDate: true },
  });
  return holds.flatMap((hold) => (hold.fromDate && hold.toDate ? [{ from: hold.fromDate, to: hold.toDate }] : []));
}

/** The holds of the contract that still count against a new one: approved ones, and those waiting for approval. */
export async function openHolds(db: Db, contractId: string): Promise<{ from: Date; to: Date }[]> {
  const holds = await db.contractChangeVoucher.findMany({
    where: { contractId, kind: "HOLD", status: { in: ["APPROVED", "PENDING"] } },
    select: { fromDate: true, toDate: true },
  });
  return holds.flatMap((hold) => (hold.fromDate && hold.toDate ? [{ from: hold.fromDate, to: hold.toDate }] : []));
}

/** Refuses a day inside an approved hold: a held contract is not booked, checked in, or completed (M8.1, A-222). */
export async function holdCovering(db: Db, contractId: string, day: Date): Promise<boolean> {
  const hold = await db.contractChangeVoucher.findFirst({
    where: { contractId, kind: "HOLD", status: "APPROVED", fromDate: { lte: day }, toDate: { gte: day } },
    select: { id: true },
  });
  return hold !== null;
}
