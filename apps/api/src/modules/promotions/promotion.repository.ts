import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

const withServices = {
  services: { select: { service: { select: { id: true, name: true } } }, orderBy: { service: { name: "asc" } } },
} as const satisfies Prisma.PromotionInclude;

export type PromotionRecord = Prisma.PromotionGetPayload<{ include: typeof withServices }>;

export type PromotionWrite = {
  kind: "PROMOTION" | "VOUCHER";
  name: string;
  code: string | null;
  discountType: "PERCENT" | "AMOUNT";
  value: number;
  validFrom: Date | null;
  validTo: Date | null;
  active: boolean;
};

export function listPromotions(db: Db, where: Prisma.PromotionWhereInput): Promise<PromotionRecord[]> {
  return db.promotion.findMany({
    where,
    include: withServices,
    orderBy: [{ kind: "asc" }, { active: "desc" }, { name: "asc" }],
  });
}

export function findPromotion(db: Db, id: string): Promise<PromotionRecord | null> {
  return db.promotion.findUnique({ where: { id }, include: withServices });
}

export function findVoucherByCode(db: Db, code: string): Promise<PromotionRecord | null> {
  return db.promotion.findFirst({ where: { kind: "VOUCHER", code }, include: withServices });
}

export async function createPromotion(db: Db, data: PromotionWrite, serviceIds: string[]): Promise<PromotionRecord> {
  const created = await db.promotion.create({
    data: { ...data, services: { create: serviceIds.map((serviceId) => ({ serviceId })) } },
    select: { id: true },
  });
  return db.promotion.findUniqueOrThrow({ where: { id: created.id }, include: withServices });
}

export async function updatePromotion(
  db: Db,
  id: string,
  data: PromotionWrite,
  serviceIds: string[],
): Promise<PromotionRecord> {
  await db.promotion.update({ where: { id }, data });
  await db.promotionService.deleteMany({ where: { promotionId: id, serviceId: { notIn: serviceIds } } });
  await db.promotionService.createMany({
    data: serviceIds.map((serviceId) => ({ promotionId: id, serviceId })),
    skipDuplicates: true,
  });
  return db.promotion.findUniqueOrThrow({ where: { id }, include: withServices });
}

export async function countServices(db: Db, ids: string[]): Promise<number> {
  return db.service.count({ where: { id: { in: ids } } });
}

export async function discountThresholdOfRole(db: Db, roleId: string): Promise<number> {
  const role = await db.role.findUnique({ where: { id: roleId }, select: { discountThresholdPct: true } });
  return Number(role?.discountThresholdPct ?? 0);
}
