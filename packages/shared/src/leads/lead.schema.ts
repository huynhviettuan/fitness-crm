import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { optionalCountry } from "../countries/country.schema.js";
import { GENDERS } from "../employees/employee.schema.js";
import { optionChoice, optionNote } from "../options/option.schema.js";
import { formatCode } from "../parameters/parameter.schema.js";
import { calendarDate, hasNoControlCharacters, normalizePhone, parseDateOnly, timeOfDay } from "../validation/index.js";
import { MANUAL_LEAD_STATUSES, RECARE_STATUSES } from "./lead.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

/**
 * A person is a lead until Show, then a customer, in one record (D-019). The stage
 * decides which screens list them; the record id never changes.
 */
export const PERSON_STAGES = ["LEAD", "CUSTOMER"] as const;
export type PersonStage = (typeof PERSON_STAGES)[number];

/** The lead journey (D-020, brief §3); which moves are allowed is in lead.domain.ts. */
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

/** Vietnamese or foreign: derived from the country (D-057); the email language follows it (A-027). */
export const NATIONALITY_GROUPS = ["VIETNAM", "FOREIGN"] as const;
export type NationalityGroup = (typeof NATIONALITY_GROUPS)[number];

/** D-038: the configured prefix + at least 6 digits, e.g. LD000123. */
export function formatLeadCode(prefix: string, sequenceValue: bigint | number): string {
  return formatCode(prefix, sequenceValue, 6);
}

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** "" or null for none. */
const optionalChoice = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "invalidChoice" }).nullable(),
);
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
  /** How they heard of the gym ("leadSources"), its classification, and the detail. */
  sourceId: optionalChoice.prefault(""),
  sourceNote: optionNote,
  sourceType: optionalEnum(SOURCE_TYPES).prefault(""),
  sourceDetail: text(200).transform(emptyToNull).prefault(""),
  /** The nationality, a country of ISO 3166-1; the Vietnamese / foreign group follows from it (D-057). */
  countryCode: optionalCountry.prefault(""),
  needGroupId: optionalChoice.prefault(""),
  needGroupNote: optionNote,
  /** An entry of the coded catalog "needDetails" (D-066); `needDetail` is the note written with it. */
  needDetailId: optionalChoice.prefault(""),
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
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const listLeadsSchema = z.object({
  q: text(100).prefault(""),
  status: optional(z.enum(LEAD_STATUSES, { error: "invalidChoice" })),
  channelId: optional(z.uuid({ error: "invalidChoice" })),
  sourceId: optional(z.uuid({ error: "invalidChoice" })),
  needGroupId: optional(z.uuid({ error: "invalidChoice" })),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/** The Kanban board (FR-LEAD-006) takes the list's filters; its columns are the statuses. */
export const leadBoardQuerySchema = listLeadsSchema.omit({ status: true, page: true, pageSize: true });

/**
 * Moving a lead along its journey (D-020). Appointment booked needs the day and time
 * they come in (gym-local); Refused needs a reason from "leadRefuseReasons" (BR-204).
 * The note is optional and goes with the change, never instead of a result.
 */
export const leadStatusChangeSchema = z
  .object({
    status: z.enum(MANUAL_LEAD_STATUSES, { error: "invalidChoice" }),
    appointmentDate: text(10).prefault(""),
    appointmentTime: text(5).prefault(""),
    refuseReasonId: optionalChoice.prefault(""),
    refuseReasonNote: optionNote,
    note: text(1000).transform(emptyToNull).prefault(""),
  })
  .transform((value, ctx) => {
    let appointment: { date: Date; time: string } | null = null;
    if (value.status === "BOOKED") {
      const date = calendarDate.safeParse(value.appointmentDate);
      const time = timeOfDay.safeParse(value.appointmentTime);
      if (!date.success)
        ctx.addIssue({ code: "custom", path: ["appointmentDate"], message: date.error.issues[0].message });
      if (!time.success)
        ctx.addIssue({ code: "custom", path: ["appointmentTime"], message: time.error.issues[0].message });
      if (!date.success || !time.success) return z.NEVER;
      appointment = { date: date.data, time: time.data };
    }
    if (value.status === "REFUSED" && !value.refuseReasonId) {
      ctx.addIssue({ code: "custom", path: ["refuseReasonId"], message: "required" });
      return z.NEVER;
    }
    return {
      status: value.status,
      appointment,
      refuseReason:
        value.status === "REFUSED" && value.refuseReasonId
          ? { optionId: value.refuseReasonId, note: value.refuseReasonNote }
          : null,
      note: value.note,
    };
  });

/** A manager hands the lead to someone who receives leads (BR-203). */
export const leadAssignSchema = z.object({ userId: z.uuid({ error: "required" }) });

export type LeadStatusChangeInput = z.input<typeof leadStatusChangeSchema>;
/** A status change as parsed: the appointment and refusal reason checked in shape. */
export type LeadStatusChange = z.output<typeof leadStatusChangeSchema>;
export type LeadAssignInput = z.input<typeof leadAssignSchema>;
export type LeadInput = z.input<typeof leadInputSchema>;
export type LeadData = z.output<typeof leadInputSchema>;
export type LeadUpdateInput = z.input<typeof leadUpdateSchema>;

/**
 * The same person wrote or came in again (BR-202, FR-LEAD-009): the intake form's channel,
 * source, and need, and a note, added to the existing record as a new inquiry (A-063).
 */
export const leadInquiryInputSchema = z.object({
  channelId: leadFields.channelId,
  channelNote: leadFields.channelNote,
  sourceId: leadFields.sourceId,
  sourceNote: leadFields.sourceNote,
  sourceType: leadFields.sourceType,
  sourceDetail: leadFields.sourceDetail,
  needGroupId: leadFields.needGroupId,
  needGroupNote: leadFields.needGroupNote,
  needDetail: leadFields.needDetail,
  note: leadFields.notes,
});

/**
 * "Danh sách tái chăm sóc" (FR-LEAD-007): leads in No response, Refused, or No show, by
 * contact-again day. `scope` mine: in my charge; all: every lead I may see.
 */
export const recareQuerySchema = z.object({
  status: optional(z.enum(RECARE_STATUSES, { error: "invalidChoice" })),
  picUserId: optional(z.uuid({ error: "invalidChoice" })),
  /** Only those whose contact-again day has passed. */
  overdue: z
    .union([z.boolean(), z.enum(["true", "false", ""])])
    .transform((value) => value === true || value === "true")
    .prefault(false),
  scope: z.enum(["mine", "all"], { error: "invalidChoice" }).prefault("mine"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * A manager merges two records of one person (BR-202, A-064): `mergedId` goes to the trash
 * with the reason ("deleteReasons", "Khác" needs a note); the other record, the one named
 * in the path, survives or not by the rule of A-064 (the response says which).
 */
export const mergeInputSchema = z.object({
  mergedId: z.uuid({ error: "required" }),
  reasonId: optionChoice,
  reasonNote: optionNote,
});

export type LeadInquiryInput = z.input<typeof leadInquiryInputSchema>;
export type RecareQuery = z.output<typeof recareQuerySchema>;
export type MergeInput = z.input<typeof mergeInputSchema>;
