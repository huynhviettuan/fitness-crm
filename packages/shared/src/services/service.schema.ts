import { z } from "zod";
import { calendarDate, hasNoControlCharacters, timeOfDay, vndAmount } from "../validation/index.js";
import { SERVICE_KINDS, tiersProblems } from "./service.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Forms send text; an empty optional field is stored as null.

const wholeNumber = (min: number, max: number) =>
  z
    .union([z.number(), z.string()], { error: "invalidNumber" })
    .pipe(
      z.coerce
        .number<string | number>({ error: "invalidNumber" })
        .int({ error: "invalidNumber" })
        .min(min, { error: "invalidNumber" })
        .max(max, { error: "invalidNumber" }),
    );

/** A whole number, or empty for none. */
const optionalWhole = (min: number, max: number) =>
  z
    .union([z.literal(""), z.null(), wholeNumber(min, max)], { error: "invalidNumber" })
    .transform((value) => (value === "" ? null : value));

const emptyToNull = (value: string) => (value === "" ? null : value);

const name = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .max(100, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" })
  .regex(/^[^\r\n\t]*$/, { error: "invalidCharacters" });

/** A percent with up to two decimals. */
const commissionRate = z
  .union([z.number(), z.string()], { error: "invalidNumber" })
  .pipe(
    z.coerce
      .number<string | number>({ error: "invalidNumber" })
      .min(0, { error: "invalidNumber" })
      .max(100, { error: "invalidNumber" }),
  )
  .transform((value) => Math.round(value * 100) / 100);

const optionalTime = z.union([z.literal(""), z.null(), timeOfDay]).transform((value) => (value === "" ? null : value));
const optionalDay = z
  .union([z.literal(""), z.null(), calendarDate])
  .transform((value) => (value === "" ? null : value));

export const serviceInputSchema = z
  .object({
    name,
    kind: z.enum(SERVICE_KINDS, { error: "invalidChoice" }),
    branchIds: z
      .array(z.uuid({ error: "invalidChoice" }), { error: "required" })
      .min(1, { error: "required" })
      .max(50, { error: "tooLong" }),
    allowedFrom: optionalTime.prefault(""),
    allowedTo: optionalTime.prefault(""),
    commissionRate: commissionRate.prefault(0),
    isGroup: z.boolean({ error: "invalidChoice" }).prefault(false),
    maxMembers: optionalWhole(2, 50).prefault(""),
    maxPerWeek: optionalWhole(1, 50).prefault(""),
    maxPerDay: optionalWhole(1, 10).prefault(""),
    activeFrom: optionalDay.prefault(""),
    activeTo: optionalDay.prefault(""),
    active: z.boolean({ error: "invalidChoice" }).prefault(true),
    notes: z
      .string()
      .trim()
      .max(2000, { error: "tooLong" })
      .refine(hasNoControlCharacters, { error: "invalidCharacters" })
      .transform(emptyToNull)
      .prefault(""),
  })
  .superRefine((value, ctx) => {
    if ((value.allowedFrom === null) !== (value.allowedTo === null)) {
      ctx.addIssue({
        code: "custom",
        path: [value.allowedFrom === null ? "allowedFrom" : "allowedTo"],
        message: "required",
      });
    } else if (value.allowedFrom !== null && value.allowedTo !== null && value.allowedTo <= value.allowedFrom) {
      ctx.addIssue({ code: "custom", path: ["allowedTo"], message: "endTimeNotAfterStart" });
    }
    if (value.isGroup && value.maxMembers === null) {
      ctx.addIssue({ code: "custom", path: ["maxMembers"], message: "required" });
    }
    if (value.activeFrom && value.activeTo && value.activeTo.getTime() < value.activeFrom.getTime()) {
      ctx.addIssue({ code: "custom", path: ["activeTo"], message: "endBeforeStart" });
    }
  });

export const priceTierInputSchema = z
  .object({
    minSessions: wholeNumber(1, 1000),
    maxSessions: optionalWhole(1, 1000),
    unitPrice: vndAmount,
    validityMonths: wholeNumber(0, 60),
    validityDays: wholeNumber(0, 365),
  })
  .refine((tier) => tier.validityMonths + tier.validityDays > 0, {
    path: ["validityMonths"],
    error: "validityRequired",
  });

/**
 * A new version of a service's price tiers (BR-301): the whole set, from `effectiveFrom`. Contracts already signed keep
 * the price they were signed at.
 */
export const tiersInputSchema = z
  .object({
    effectiveFrom: calendarDate,
    tiers: z
      .array(priceTierInputSchema, { error: "required" })
      .min(1, { error: "required" })
      .max(50, { error: "tooLong" }),
  })
  .superRefine((value, ctx) => {
    for (const problem of tiersProblems(value.tiers))
      ctx.addIssue({ code: "custom", path: ["tiers"], message: problem });
  });

/** The quick-pick counts of a service: buttons that only fill in the number of sessions (FR-SVC-003). */
export const quickPackagesInputSchema = z.object({
  sessions: z
    .array(wholeNumber(1, 1000), { error: "required" })
    .max(20, { error: "tooLong" })
    .refine((values) => new Set(values).size === values.length, { error: "duplicateSessions" })
    .transform((values) => [...values].sort((a, b) => a - b)),
});

export const listServicesSchema = z.object({
  kind: z.enum(SERVICE_KINDS).optional(),
  branchId: z.uuid().optional(),
  /** Only the services on sale today (active, inside their validity); for the contract form. */
  onSale: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export const lookupSchema = z.object({
  sessions: z.coerce.number().int().min(1).max(1000),
  /** The contract's start day, dd/MM/yyyy; the end date is answered when given. */
  startDate: calendarDate.optional(),
  /** The day whose prices apply (the contract date), dd/MM/yyyy; today when not given. */
  asOf: calendarDate.optional(),
});

export type ServiceInput = z.input<typeof serviceInputSchema>;
export type TiersInput = z.input<typeof tiersInputSchema>;
export type QuickPackagesInput = z.input<typeof quickPackagesInputSchema>;
