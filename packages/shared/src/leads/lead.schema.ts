import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { GENDERS } from "../employees/employee.schema.js";
import { optionNote } from "../options/option.schema.js";
import { formatCode } from "../parameters/parameter.schema.js";
import { hasNoControlCharacters, normalizePhone, parseDateOnly } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

/**
 * A person is a lead until Show, then a customer, in one record (D-019). The stage
 * decides which screens list them; the record id never changes.
 */
export const PERSON_STAGES = ["LEAD", "CUSTOMER"] as const;
export type PersonStage = (typeof PERSON_STAGES)[number];

/** The lead journey (D-020, brief §3). Moving between them arrives in M2 slice 2. */
export const LEAD_STATUSES = [
  "NEW",
  "CONSULTING",
  "CONSIDERING",
  "NO_RESPONSE",
  "BOOKED",
  "SHOWED",
  "NO_SHOW",
  "REFUSED",
  "CONTRACTED",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** How a source is classified (brief §4.1); fixed, since reports split by it (A-049). */
export const SOURCE_TYPES = ["ORGANIC", "PAID"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Vietnamese or foreign; fixed, since the email language follows it (A-027, A-049). */
export const NATIONALITY_GROUPS = ["VIETNAM", "FOREIGN"] as const;
export type NationalityGroup = (typeof NATIONALITY_GROUPS)[number];

/** D-038: the configured prefix + at least 6 digits, e.g. LD000123. */
export function formatLeadCode(prefix: string, sequenceValue: bigint | number): string {
  return formatCode(prefix, sequenceValue, 6);
}

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** "" or null for none. */
const optionalChoice = z.preprocess((value) => (value === "" ? null : value), z.uuid({ error: "invalidChoice" }).nullable());
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((value) => (value === "" ? null : value), z.enum(values, { error: "invalidChoice" }).nullable());

/** Optional for a lead: digital leads often write without one (brief §3, stage 1). */
const phone = z
  .string()
  .trim()
  .transform(normalizePhone)
  .pipe(z.union([z.literal(""), z.string().regex(/^\+?\d{8,15}$/, { error: "invalidPhone" })]))
  .transform(emptyToNull);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(""), z.email({ error: "invalidEmail" })]))
  .transform(emptyToNull);

// dd/MM/yyyy, not in the future.
const birthDate = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const date = parseDateOnly(value);
    if (!date || date.getTime() > Date.now()) {
      ctx.addIssue({ code: "custom", message: "invalidDate" });
      return z.NEVER;
    }
    return date;
  });

/** The lead profile of brief §4.1. Each choice comes from its option list (D-016). */
const leadFields = {
  fullName: text(150).pipe(z.string().min(1, { error: "required" })),
  gender: optionalEnum(GENDERS).prefault(""),
  birthDate: birthDate.prefault(""),
  phone: phone.prefault(""),
  email: email.prefault(""),
  /** Where the lead wrote from ("leadChannels"); required, so every lead is counted by channel (AC-06). */
  channelId: z.uuid({ error: "required" }),
  channelNote: optionNote,
  /** How they heard of Flow ("leadSources"), its classification, and the detail. */
  sourceId: optionalChoice.prefault(""),
  sourceNote: optionNote,
  sourceType: optionalEnum(SOURCE_TYPES).prefault(""),
  sourceDetail: text(200).transform(emptyToNull).prefault(""),
  nationalityGroup: optionalEnum(NATIONALITY_GROUPS).prefault(""),
  needGroupId: optionalChoice.prefault(""),
  needGroupNote: optionNote,
  needDetail: text(1000).transform(emptyToNull).prefault(""),
  painStatusId: optionalChoice.prefault(""),
  painStatusNote: optionNote,
  assessmentTypeId: optionalChoice.prefault(""),
  assessmentTypeNote: optionNote,
  notes: text(2000).transform(emptyToNull).prefault(""),
};

/** The quick intake form (FR-LEAD-001): walk-ins and channels not connected yet. */
export const leadInputSchema = z.object({ branchId: branchChoice, ...leadFields });

/** Edits send every field; the branch stays. */
export const leadUpdateSchema = z.object(leadFields);

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const listLeadsSchema = z.object({
  q: text(100).prefault(""),
  status: optional(z.enum(LEAD_STATUSES, { error: "invalidChoice" })),
  channelId: optional(z.uuid({ error: "invalidChoice" })),
  sourceId: optional(z.uuid({ error: "invalidChoice" })),
  needGroupId: optional(z.uuid({ error: "invalidChoice" })),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type LeadInput = z.input<typeof leadInputSchema>;
export type LeadData = z.output<typeof leadInputSchema>;
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>;
