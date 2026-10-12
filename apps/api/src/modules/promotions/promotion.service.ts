import { z } from "zod";
import {
  discountPercentOf,
  isWithin,
  listPromotionsSchema,
  needsEscalation,
  priceBreakdown,
  promotionInputSchema,
  quoteSchema,
  type Discount,
  type Promotion,
  type PriceQuote,
} from "@flow/shared/promotions";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { lookupPrice } from "../services/service.service.js";
import * as repo from "./promotion.repository.js";

// Promotions and vouchers (brief §5.1, D-021, BR-303, A-110). A promotion is a discount picked from the list on offer, a
// voucher one found by its code. Both take a percent or an amount off the tier price, so neither is an exception price.
// Admin manages them; those who sell see the promotions on offer and quote a price.

const AUDITED_FIELDS = ["kind", "name", "code", "discountType", "value", "validFrom", "validTo", "active"] as const;

const gymToday = () => calendarDateInTimeZone(env.GYM_TIMEZONE);

type Record_ = repo.PromotionRecord;

/** Whether the offer can be used on `day` for a service: active, inside its dates, and covering the service. */
function usable(record: Record_, serviceId: string, day: Date): boolean {
  return (
    record.active &&
    isWithin(day, record.validFrom, record.validTo) &&
    (record.services.length === 0 || record.services.some((row) => row.service.id === serviceId))
  );
}

/**
 * Admin sees every promotion and voucher with its code. Everyone else sees only the promotions on offer today, with no
 * vouchers: a voucher's code is typed by staff who were given it, never listed.
 */
export async function listPromotions(actor: Actor, rawQuery: unknown): Promise<Promotion[]> {
  assertCan(actor, "service.view");
  const query = parseInput(listPromotionsSchema, rawQuery);
  const manager = actor.permissions.has("promotion.manage");
  const today = gymToday();
  const where: Prisma.PromotionWhereInput = {
    AND: [
      query.kind ? { kind: query.kind } : {},
      manager ? {} : { kind: "PROMOTION" },
      manager && !query.onOffer ? {} : { active: true },
      query.onOffer || !manager
        ? {
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: today } }] },
              { OR: [{ validTo: null }, { validTo: { gte: today } }] },
            ],
          }
        : {},
    ],
  };
  return (await repo.listPromotions(prisma, where)).map((record) => present(record, manager));
}

export async function createPromotion(actor: Actor, rawInput: unknown): Promise<Promotion> {
  assertCan(actor, "promotion.manage");
  const { serviceIds, ...data } = parseInput(promotionInputSchema, rawInput);
  return mapCodeConflicts(() =>
    prisma.$transaction(async (tx) => {
      await assertServices(tx, serviceIds);
      const created = await repo.createPromotion(tx, data, serviceIds);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "promotion",
        entityId: created.id,
        action: "promotion.created",
        after: { ...auditable(created), serviceIds },
      });
      return present(created, true);
    }),
  );
}

/** All fields are sent. A promotion is made inactive, never deleted; its kind and code cannot change once made. */
export async function updatePromotion(actor: Actor, id: string, rawInput: unknown): Promise<Promotion> {
  assertCan(actor, "promotion.manage");
  const { serviceIds, ...data } = parseInput(promotionInputSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return mapCodeConflicts(() =>
    prisma.$transaction(async (tx) => {
      const before = await repo.findPromotion(tx, id);
      if (!before) throw new AppError("NOT_FOUND");
      if (before.kind !== data.kind)
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { kind: ["invalidChoice"] } });
      if (before.code !== data.code)
        throw new AppError("VALIDATION_FAILED", { fieldErrors: { code: ["invalidChoice"] } });
      await assertServices(tx, serviceIds);
      const after = await repo.updatePromotion(tx, id, data, serviceIds);
      const beforeValues: Record<string, unknown> = { ...auditable(before), serviceIds: serviceIdsOf(before) };
      const afterValues: Record<string, unknown> = { ...auditable(after), serviceIds: serviceIdsOf(after) };
      const changes = diffFields(beforeValues, afterValues, [...AUDITED_FIELDS, "serviceIds"]);
      if (changes) {
        await recordAudit(tx, {
          actorUserId: actor.id,
          entityType: "promotion",
          entityId: id,
          action: "promotion.updated",
          ...changes,
        });
      }
      return present(after, true);
    }),
  );
}

/**
 * What a contract would cost (BR-301, A-110, A-111): the tier price of the version in force on `asOf`, then the chosen
 * promotion, then the voucher on what is left, then VAT on the discounted price. A promotion or voucher that is
 * inactive, outside its dates, or not for this service is refused, never ignored.
 */
export async function quotePrice(actor: Actor, serviceId: string, rawQuery: unknown): Promise<PriceQuote> {
  assertCan(actor, "service.view");
  const query = parseInput(quoteSchema, rawQuery);
  const lookup = await lookupPrice(actor, serviceId, {
    sessions: String(query.sessions),
    ...(query.startDate ? { startDate: formatDay(query.startDate) } : {}),
    ...(query.asOf ? { asOf: formatDay(query.asOf) } : {}),
  });
  const day = query.asOf ?? gymToday();

  const { promotion, voucher } = await resolveOffers(serviceId, day, query);

  const breakdown = priceBreakdown({
    unitPrice: lookup.unitPrice,
    sessions: lookup.sessions,
    promotion: promotion && discountOfOffer(promotion),
    voucher: voucher && discountOfOffer(voucher),
    vatPercent: query.vatPercent,
  });
  return {
    ...lookup,
    promotion: promotion && { id: promotion.id, name: promotion.name },
    voucher: voucher && { id: voucher.id, name: voucher.name },
    breakdown,
    discountPercent: discountPercentOf(breakdown.gross, breakdown.totalDiscount),
  };
}

/**
 * The promotion and the voucher a price takes, found and checked for the service and the day: one that is off, outside
 * its dates, or not for the service is refused, never ignored (A-110).
 */
export async function resolveOffers(
  serviceId: string,
  day: Date,
  choice: { promotionId?: string | null; voucherCode?: string | null },
): Promise<{ promotion: Record_ | null; voucher: Record_ | null }> {
  const promotion = choice.promotionId ? await offer(choice.promotionId, "PROMOTION", serviceId, day) : null;
  if (choice.promotionId && !promotion) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { promotionId: ["promotionNotValid"] } });
  }
  const voucher = choice.voucherCode ? await voucherByCode(choice.voucherCode, serviceId, day) : null;
  if (choice.voucherCode && !voucher) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { voucherCode: ["voucherNotValid"] } });
  }
  return { promotion, voucher };
}

export const discountOfOffer = (record: { discountType: "PERCENT" | "AMOUNT"; value: unknown }): Discount => ({
  type: record.discountType,
  value: Number(record.value),
});

/**
 * Whether holders of the actor's role may approve a contract with this total discount, as a percent of the tier price
 * (A-112). Above the role's limit the contract needs a role with a higher one.
 */
export async function canApproveDiscount(
  db: Db,
  actor: Pick<Actor, "roleId">,
  discountPercent: number,
): Promise<boolean> {
  return !needsEscalation(discountPercent, await repo.discountThresholdOfRole(db, actor.roleId));
}

async function offer(id: string, kind: "PROMOTION" | "VOUCHER", serviceId: string, day: Date): Promise<Record_ | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const record = await repo.findPromotion(prisma, id);
  return record && record.kind === kind && usable(record, serviceId, day) ? record : null;
}

async function voucherByCode(code: string, serviceId: string, day: Date): Promise<Record_ | null> {
  const record = await repo.findVoucherByCode(prisma, code);
  return record && usable(record, serviceId, day) ? record : null;
}

const formatDay = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

async function assertServices(db: Db, serviceIds: string[]): Promise<void> {
  if (serviceIds.length > 0 && (await repo.countServices(db, serviceIds)) !== serviceIds.length) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { serviceIds: ["invalidChoice"] } });
  }
}

async function mapCodeConflicts<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("VALIDATION_FAILED", { fieldErrors: { code: ["codeTaken"] } });
    throw error;
  }
}

const serviceIdsOf = (record: Record_) => record.services.map((row) => row.service.id).sort();

function auditable(record: Record_): Record<string, unknown> {
  return { ...Object.fromEntries(AUDITED_FIELDS.map((key) => [key, record[key]])), value: Number(record.value) };
}

function present(record: Record_, manager: boolean): Promotion {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    code: manager ? record.code : null,
    discountType: record.discountType,
    value: Number(record.value),
    validFrom: record.validFrom,
    validTo: record.validTo,
    services: record.services.map((row) => row.service),
    active: record.active,
    createdAt: record.createdAt,
  };
}
