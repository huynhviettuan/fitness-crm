import { z } from "zod";
import { instant, listOf } from "../validation/index.js";
import { SERVICE_KINDS } from "./service.domain.js";

export const priceTierSchema = z
  .object({
    id: z.uuid(),
    minSessions: z.int(),
    maxSessions: z.int().nullable(),
    unitPrice: z.number(),
    validityMonths: z.int(),
    validityDays: z.int(),
  })
  .meta({ id: "PriceTier" });
export type PriceTier = z.infer<typeof priceTierSchema>;

export const priceTierVersionSchema = z
  .object({
    id: z.uuid(),
    version: z.int(),
    /** A calendar day as UTC midnight. */
    effectiveFrom: instant,
    createdAt: instant,
    createdBy: z.string().nullable(),
    tiers: z.array(priceTierSchema),
  })
  .meta({ id: "PriceTierVersion" });
export type PriceTierVersion = z.infer<typeof priceTierVersionSchema>;

export const serviceSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(SERVICE_KINDS),
    branches: z.array(z.object({ id: z.uuid(), name: z.string() })),
    allowedFrom: z.string().nullable(),
    allowedTo: z.string().nullable(),
    commissionRate: z.number(),
    isGroup: z.boolean(),
    maxMembers: z.int().nullable(),
    maxPerWeek: z.int().nullable(),
    maxPerDay: z.int().nullable(),
    activeFrom: instant.nullable(),
    activeTo: instant.nullable(),
    active: z.boolean(),
    notes: z.string().nullable(),
    createdAt: instant,
    /** The version of the tiers in force today, or null when none has started. */
    currentVersion: z.int().nullable(),
  })
  .meta({ id: "Service" });
export type Service = z.infer<typeof serviceSchema>;

export const serviceListSchema = listOf(serviceSchema).meta({ id: "ServiceList" });

export const serviceDetailSchema = serviceSchema
  .extend({
    versions: z.array(priceTierVersionSchema),
    quickPackages: z.array(z.int()),
  })
  .meta({ id: "ServiceDetail" });
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;

/** What a session count costs (BR-301): the tier, the total, the display name, and the end date when a start was given. */
export const priceLookupSchema = z
  .object({
    serviceId: z.uuid(),
    versionId: z.uuid(),
    version: z.int(),
    tierId: z.uuid(),
    sessions: z.int(),
    unitPrice: z.number(),
    total: z.number(),
    validityMonths: z.int(),
    validityDays: z.int(),
    displayName: z.string(),
    endDate: instant.nullable(),
  })
  .meta({ id: "PriceLookup" });
export type PriceLookup = z.infer<typeof priceLookupSchema>;
