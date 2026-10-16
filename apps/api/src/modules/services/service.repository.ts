import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { PriceTierRow } from "@gymcrm/shared/services";

const withRefs = {
  branches: { select: { branch: { select: { id: true, name: true } } }, orderBy: { branch: { name: "asc" } } },
  versions: {
    orderBy: { version: "asc" },
    include: {
      tiers: { orderBy: { minSessions: "asc" } },
      createdBy: { select: { name: true } },
    },
  },
  quickPackages: { orderBy: { sessions: "asc" } },
} as const satisfies Prisma.ServiceInclude;

export type ServiceRecord = Prisma.ServiceGetPayload<{ include: typeof withRefs }>;

export type ServiceWrite = {
  name: string;
  kind: "PT" | "CLASS" | "MEMBER";
  allowedFrom: string | null;
  allowedTo: string | null;
  commissionRate: number;
  isGroup: boolean;
  maxMembers: number | null;
  maxPerWeek: number | null;
  maxPerDay: number | null;
  activeFrom: Date | null;
  activeTo: Date | null;
  active: boolean;
  notes: string | null;
};

export function listServices(db: Db, where: Prisma.ServiceWhereInput): Promise<ServiceRecord[]> {
  return db.service.findMany({ where, include: withRefs, orderBy: [{ kind: "asc" }, { name: "asc" }] });
}

export function findService(db: Db, id: string, where: Prisma.ServiceWhereInput = {}): Promise<ServiceRecord | null> {
  return db.service.findFirst({ where: { AND: [{ id }, where] }, include: withRefs });
}

export async function createService(db: Db, data: ServiceWrite, branchIds: string[]): Promise<ServiceRecord> {
  const service = await db.service.create({
    data: { ...data, branches: { create: branchIds.map((branchId) => ({ branchId })) } },
    select: { id: true },
  });
  return db.service.findUniqueOrThrow({ where: { id: service.id }, include: withRefs });
}

export async function updateService(
  db: Db,
  id: string,
  data: ServiceWrite,
  branchIds: string[],
): Promise<ServiceRecord> {
  await db.service.update({ where: { id }, data });
  await db.serviceBranch.deleteMany({ where: { serviceId: id, branchId: { notIn: branchIds } } });
  await db.serviceBranch.createMany({
    data: branchIds.map((branchId) => ({ serviceId: id, branchId })),
    skipDuplicates: true,
  });
  return db.service.findUniqueOrThrow({ where: { id }, include: withRefs });
}

/** Holds the service's row until the transaction ends, so two new versions never take the same number. */
export function setImage(db: Db, id: string, fileId: string | null): Promise<ServiceRecord> {
  return db.service.update({ where: { id }, data: { imageFileId: fileId }, include: withRefs });
}

export async function lockService(db: Db, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "services" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export async function latestVersion(db: Db, serviceId: string) {
  return db.priceTierVersion.findFirst({
    where: { serviceId },
    orderBy: { version: "desc" },
    select: { version: true, effectiveFrom: true },
  });
}

export async function createVersion(
  db: Db,
  input: { serviceId: string; version: number; effectiveFrom: Date; createdById: string; tiers: PriceTierRow[] },
) {
  return db.priceTierVersion.create({
    data: {
      serviceId: input.serviceId,
      version: input.version,
      effectiveFrom: input.effectiveFrom,
      createdById: input.createdById,
      tiers: { create: input.tiers },
    },
    include: { tiers: { orderBy: { minSessions: "asc" } } },
  });
}

export async function replaceQuickPackages(db: Db, serviceId: string, sessions: number[]): Promise<void> {
  await db.quickPackage.deleteMany({ where: { serviceId } });
  await db.quickPackage.createMany({ data: sessions.map((count) => ({ serviceId, sessions: count })) });
}

export function countBranches(db: Db, branchIds: string[]): Promise<number> {
  return db.branch.count({ where: { id: { in: branchIds }, active: true } });
}
