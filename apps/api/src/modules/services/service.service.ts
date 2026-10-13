import { z } from "zod";
import {
  displayNameOf,
  endDateOf,
  findTier,
  listServicesSchema,
  lookupSchema,
  quickPackagesInputSchema,
  serviceInputSchema,
  tiersInputSchema,
  versionInForce,
  type PriceLookup,
  type Service,
  type ServiceDetail,
} from "@flow/shared/services";
import { attachFileSchema } from "@flow/shared/files";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import { claimFile } from "../../platform/files/file.service.js";
import * as repo from "./service.repository.js";

// Services and price tiers (brief §5.1, D-021, BR-301). Everyone who sells reads them; only Admin edits them. A
// service is never deleted, only made inactive. A change of prices is a new version from a day on, never an edit.

const AUDITED_FIELDS = [
  "name",
  "kind",
  "allowedFrom",
  "allowedTo",
  "commissionRate",
  "isGroup",
  "maxMembers",
  "maxPerWeek",
  "maxPerDay",
  "activeFrom",
  "activeTo",
  "active",
  "notes",
] as const;

const gymToday = () => calendarDateInTimeZone(env.GYM_TIMEZONE);

/** A service is on sale when it is active and today is inside its validity. */
function onSaleWhere(today: Date): Prisma.ServiceWhereInput {
  return {
    active: true,
    AND: [
      { OR: [{ activeFrom: null }, { activeFrom: { lte: today } }] },
      { OR: [{ activeTo: null }, { activeTo: { gte: today } }] },
    ],
  };
}

/** Those who only sell see the services of their branches; Admin, who edits them, sees all. */
function visibleTo(actor: Actor): Prisma.ServiceWhereInput {
  if (actor.permissions.has("service.manage") || actor.branches === "ALL") return {};
  return { branches: { some: { branchId: { in: [...actor.branches] } } } };
}

export async function listServices(actor: Actor, rawQuery: unknown): Promise<Service[]> {
  assertCan(actor, "service.view");
  const query = parseInput(listServicesSchema, rawQuery);
  const today = gymToday();
  const records = await repo.listServices(prisma, {
    AND: [
      visibleTo(actor),
      query.kind ? { kind: query.kind } : {},
      query.branchId ? { branches: { some: { branchId: query.branchId } } } : {},
      query.onSale ? onSaleWhere(today) : {},
    ],
  });
  return records.map((record) => present(record, today));
}

export async function getService(actor: Actor, id: string): Promise<ServiceDetail> {
  assertCan(actor, "service.view");
  return detail(await getOrThrow(prisma, actor, id));
}

export async function createService(actor: Actor, rawInput: unknown): Promise<ServiceDetail> {
  assertCan(actor, "service.manage");
  const { branchIds, ...data } = parseInput(serviceInputSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    await assertBranches(tx, branchIds);
    await assertNameFree(tx, data.name, null);
    const created = await repo.createService(tx, data, branchIds);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "service",
      entityId: created.id,
      action: "service.created",
      after: { ...auditable(created), branchIds },
    });
    return detail(created);
  });
}

/** All fields are sent. */
export async function updateService(actor: Actor, id: string, rawInput: unknown): Promise<ServiceDetail> {
  assertCan(actor, "service.manage");
  const { branchIds, ...data } = parseInput(serviceInputSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockService(tx, id))) throw new AppError("NOT_FOUND");
    const before = await getOrThrow(tx, actor, id);
    await assertBranches(tx, branchIds);
    await assertNameFree(tx, data.name, id);
    const after = await repo.updateService(tx, id, data, branchIds);
    const beforeValues: Record<string, unknown> = { ...auditable(before), branchIds: branchIdsOf(before) };
    const afterValues: Record<string, unknown> = { ...auditable(after), branchIds: branchIdsOf(after) };
    const changes = diffFields(beforeValues, afterValues, [...AUDITED_FIELDS, "branchIds"]);
    if (changes) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "service",
        entityId: id,
        action: "service.updated",
        ...changes,
      });
    }
    return detail(after);
  });
}

/**
 * Sets or takes off the picture of a service (M4.1b, A-143). The file must be an unattached service picture the actor
 * uploaded; the old picture stays in the storage but is no longer shown.
 */
export async function setServiceImage(actor: Actor, id: string, rawInput: unknown): Promise<ServiceDetail> {
  assertCan(actor, "service.manage");
  const { fileId } = parseInput(attachFileSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockService(tx, id))) throw new AppError("NOT_FOUND");
    const before = await getOrThrow(tx, actor, id);
    if (fileId) await claimFile(tx, actor, fileId, "service_image", before.imageFileId);
    const after = await repo.setImage(tx, id, fileId);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "service",
      entityId: id,
      action: "service.imageChanged",
      before: { imageFileId: before.imageFileId },
      after: { imageFileId: fileId },
    });
    return detail(after);
  });
}

/**
 * Saves a new version of the tiers (BR-301): the whole set, from a day on. It starts today or later, and after the
 * version before it, so what was in force on any day never changes; contracts keep the version they were signed at.
 */
export async function saveTiers(actor: Actor, id: string, rawInput: unknown): Promise<ServiceDetail> {
  assertCan(actor, "service.manage");
  const input = parseInput(tiersInputSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockService(tx, id))) throw new AppError("NOT_FOUND");
    const latest = await repo.latestVersion(tx, id);
    if (latest && input.effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { effectiveFrom: ["effectiveAfterLatest"] } });
    }
    if (latest && input.effectiveFrom.getTime() < gymToday().getTime()) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { effectiveFrom: ["effectiveInPast"] } });
    }
    const version = await repo.createVersion(tx, {
      serviceId: id,
      version: (latest?.version ?? 0) + 1,
      effectiveFrom: input.effectiveFrom,
      createdById: actor.id,
      tiers: input.tiers,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "price_tier_version",
      entityId: version.id,
      action: "price_tier_version.created",
      after: {
        serviceId: id,
        version: version.version,
        effectiveFrom: version.effectiveFrom,
        tiers: version.tiers.map((tier) => ({
          minSessions: tier.minSessions,
          maxSessions: tier.maxSessions,
          unitPrice: Number(tier.unitPrice),
          validityMonths: tier.validityMonths,
          validityDays: tier.validityDays,
        })),
      },
    });
    return detail(await getOrThrow(tx, actor, id));
  });
}

export async function saveQuickPackages(actor: Actor, id: string, rawInput: unknown): Promise<ServiceDetail> {
  assertCan(actor, "service.manage");
  const { sessions } = parseInput(quickPackagesInputSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    if (!(await repo.lockService(tx, id))) throw new AppError("NOT_FOUND");
    const before = await getOrThrow(tx, actor, id);
    await repo.replaceQuickPackages(tx, id, sessions);
    const previous = before.quickPackages.map((pack) => pack.sessions);
    if (previous.join() !== sessions.join()) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "service",
        entityId: id,
        action: "service.quick_packages_updated",
        before: { quickPackages: previous },
        after: { quickPackages: sessions },
      });
    }
    return detail(await getOrThrow(tx, actor, id));
  });
}

/**
 * What `sessions` costs (BR-301): the tier of the version in force on `asOf` (today), the unit price, the total, the
 * name the contract shows, and the end date when a start day is given. A count no tier covers is refused, never
 * rounded to a nearby tier (A-107). Nobody types a unit price.
 */
export async function lookupPrice(actor: Actor, id: string, rawQuery: unknown): Promise<PriceLookup> {
  assertCan(actor, "service.view");
  const query = parseInput(lookupSchema, rawQuery);
  const { service, version, tier } = await priceAt(prisma, actor, id, query.sessions, query.asOf ?? gymToday());
  return {
    serviceId: service.id,
    versionId: version.id,
    version: version.version,
    tierId: tier.id,
    sessions: query.sessions,
    unitPrice: tier.unitPrice,
    total: tier.unitPrice * query.sessions,
    validityMonths: tier.validityMonths,
    validityDays: tier.validityDays,
    displayName: displayNameOf(service.name, query.sessions),
    endDate: query.startDate ? endDateOf(query.startDate, tier.validityMonths, tier.validityDays) : null,
  };
}

/**
 * The tier that prices `sessions` on `day` (BR-301): the version in force that day, and the tier covering the count.
 * Nothing is rounded to a nearby tier (A-107). Contracts call this with the contract date, so an old contract keeps
 * the price it was signed at. The service is read as `actor` sees it.
 */
export async function priceAt(db: Db, actor: Actor, serviceId: string, sessions: number, day: Date) {
  const service = await getOrThrow(db, actor, serviceId);
  const version = versionInForce(service.versions, day);
  if (!version) throw new AppError("VALIDATION_FAILED", { fieldErrors: { sessions: ["noPriceVersion"] } });
  const tier = findTier(
    version.tiers.map((row) => ({ ...row, unitPrice: Number(row.unitPrice) })),
    sessions,
  );
  if (!tier) throw new AppError("VALIDATION_FAILED", { fieldErrors: { sessions: ["noPriceTier"] } });
  return { service, version, tier };
}

/** Whether the service can be sold in the branch on `day`: active, inside its validity, and a service of the branch. */
export function onSaleIn(
  service: { active: boolean; activeFrom: Date | null; activeTo: Date | null; branches: { branch: { id: string } }[] },
  branchId: string,
  day: Date,
): boolean {
  return (
    service.active &&
    (!service.activeFrom || service.activeFrom.getTime() <= day.getTime()) &&
    (!service.activeTo || service.activeTo.getTime() >= day.getTime()) &&
    service.branches.some((row) => row.branch.id === branchId)
  );
}

async function getOrThrow(db: Db, actor: Actor, id: string): Promise<repo.ServiceRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const service = await repo.findService(db, id, visibleTo(actor));
  if (!service) throw new AppError("NOT_FOUND");
  return service;
}

async function assertBranches(db: Db, branchIds: string[]): Promise<void> {
  if ((await repo.countBranches(db, [...new Set(branchIds)])) !== new Set(branchIds).size) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { branchIds: ["invalidChoice"] } });
  }
}

async function assertNameFree(db: Db, name: string, exceptId: string | null): Promise<void> {
  const taken = await db.service.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw new AppError("VALIDATION_FAILED", { fieldErrors: { name: ["nameTaken"] } });
}

const branchIdsOf = (record: repo.ServiceRecord) => record.branches.map((row) => row.branch.id).sort();

function auditable(record: repo.ServiceRecord): Record<string, unknown> {
  return {
    ...Object.fromEntries(AUDITED_FIELDS.map((key) => [key, record[key]])),
    commissionRate: Number(record.commissionRate),
  };
}

function present(record: repo.ServiceRecord, today: Date): Service {
  const version = versionInForce(record.versions, today);
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    branches: record.branches.map((row) => row.branch),
    allowedFrom: record.allowedFrom,
    allowedTo: record.allowedTo,
    commissionRate: Number(record.commissionRate),
    isGroup: record.isGroup,
    maxMembers: record.maxMembers,
    maxPerWeek: record.maxPerWeek,
    maxPerDay: record.maxPerDay,
    activeFrom: record.activeFrom,
    activeTo: record.activeTo,
    active: record.active,
    notes: record.notes,
    imageFileId: record.imageFileId,
    createdAt: record.createdAt,
    currentVersion: version?.version ?? null,
  };
}

function detail(record: repo.ServiceRecord): ServiceDetail {
  return {
    ...present(record, gymToday()),
    versions: record.versions.map((version) => ({
      id: version.id,
      version: version.version,
      effectiveFrom: version.effectiveFrom,
      createdAt: version.createdAt,
      createdBy: version.createdBy?.name ?? null,
      tiers: version.tiers.map((tier) => ({
        id: tier.id,
        minSessions: tier.minSessions,
        maxSessions: tier.maxSessions,
        unitPrice: Number(tier.unitPrice),
        validityMonths: tier.validityMonths,
        validityDays: tier.validityDays,
      })),
    })),
    quickPackages: record.quickPackages.map((pack) => pack.sessions),
  };
}
