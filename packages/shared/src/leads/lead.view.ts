import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { GENDERS } from "../employees/employee.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { BOARD_STATUSES, RECARE_STATUSES } from "./lead.domain.js";
import { ASSIGNMENT_KINDS } from "./assignment.domain.js";
import { LEAD_STATUSES, NATIONALITY_GROUPS, PERSON_STAGES, SOURCE_TYPES } from "./lead.schema.js";

const person = z.object({ id: z.uuid(), name: z.string() });

export const leadSchema = z
  .object({
    id: z.uuid(),
    leadCode: z.string(),
    /** Set at Show, when the lead becomes a customer (D-019). */
    customerCode: z.string().nullable(),
    stage: z.enum(PERSON_STAGES),
    status: z.enum(LEAD_STATUSES),
    /** When the lead entered its current status (D-020). */
    statusChangedAt: instant,
    /** Appointment booked: when they are expected. */
    appointmentAt: instant.nullable(),
    /** No response, Refused, No show: the day to contact them again (BR-204), a date at UTC midnight. */
    contactAgainOn: instant.nullable(),
    /** Refused: why (BR-204). */
    refuseReason: chosenOptionSchema.nullable(),
    branch: branchRefSchema,
    fullName: z.string(),
    gender: z.enum(GENDERS).nullable(),
    /** A calendar date at UTC midnight. */
    birthDate: instant.nullable(),
    /** Null when hidden from the user (D-017) or not given; see maskedFields. */
    phone: z.string().nullable(),
    email: z.string().nullable(),
    channel: chosenOptionSchema,
    source: chosenOptionSchema.nullable(),
    sourceType: z.enum(SOURCE_TYPES).nullable(),
    sourceDetail: z.string().nullable(),
    /** A country of ISO 3166-1; empty for old data that only says Vietnamese or foreign (D-057). */
    countryCode: z.string().nullable(),
    /** Derived from the country (D-057). */
    nationalityGroup: z.enum(NATIONALITY_GROUPS).nullable(),
    needGroup: chosenOptionSchema.nullable(),
    /** The entry chosen from the coded catalog (D-066); `needDetail` is the note written with it. */
    needDetailOption: chosenOptionSchema.nullable(),
    needDetail: z.string().nullable(),
    painStatus: chosenOptionSchema.nullable(),
    assessmentType: chosenOptionSchema.nullable(),
    /** The person in charge (PIC), given round-robin or by a manager (BR-203). */
    pic: person.nullable(),
    notes: z.string().nullable(),
    createdBy: person.nullable(),
    createdAt: instant,
    maskedFields: z.array(z.enum(["phone", "email"])),
  })
  .meta({ id: "Lead" });

export const leadPageSchema = pageOf(leadSchema).meta({ id: "LeadPage" });

/** The Kanban board (FR-LEAD-006): one column per status a lead can have, the first cards of each. */
export const leadBoardSchema = z
  .object({
    columns: z.array(z.object({ status: z.enum(BOARD_STATUSES), total: z.int(), items: z.array(leadSchema) })),
  })
  .meta({ id: "LeadBoard" });

/** `by` is null when the system did it: the creation's round-robin assignment (D-020). */
const statusEntry = z.object({
  kind: z.literal("status"),
  id: z.uuid(),
  at: instant,
  by: person.nullable(),
  /** Null for the lead's creation. */
  fromStatus: z.enum(LEAD_STATUSES).nullable(),
  toStatus: z.enum(LEAD_STATUSES),
  appointmentAt: instant.nullable(),
  refuseReason: chosenOptionSchema.nullable(),
  note: z.string().nullable(),
});
const assignmentEntry = z.object({
  kind: z.literal("assignment"),
  id: z.uuid(),
  at: instant,
  by: person.nullable(),
  from: person.nullable(),
  to: person,
  /** The round-robin at intake, a manager, or the system moving an untouched lead on (D-050, D-052). */
  how: z.enum(ASSIGNMENT_KINDS),
  /** The system's move: the working minutes the lead waited (D-052). */
  waitedMinutes: z.int().nullable(),
});

/** A note on the lead (A-074): free text, never edited or deleted. */
export const leadNoteSchema = z
  .object({ kind: z.literal("note"), id: z.uuid(), at: instant, by: person, body: z.string() })
  .meta({ id: "LeadNote" });

/** The same person wrote or came in again (BR-202): channel, source, need, and note of that inquiry. */
export const inquirySchema = z
  .object({
    kind: z.literal("inquiry"),
    id: z.uuid(),
    at: instant,
    by: person.nullable(),
    channel: chosenOptionSchema,
    source: chosenOptionSchema.nullable(),
    sourceType: z.enum(SOURCE_TYPES).nullable(),
    sourceDetail: z.string().nullable(),
    needGroup: chosenOptionSchema.nullable(),
    needDetail: z.string().nullable(),
    note: z.string().nullable(),
  })
  .meta({ id: "LeadInquiry" });

/**
 * Two records of one person were merged (A-064): on the survivor's timeline, "merged from
 * LD-xxxx"; the merged record's codes stay reserved. `by` is who merged them.
 */
export const mergeEntry = z
  .object({
    kind: z.literal("merge"),
    id: z.uuid(),
    at: instant,
    by: person.nullable(),
    /** The merged record's codes (D-038). */
    mergedLeadCode: z.string().nullable(),
    mergedCustomerCode: z.string().nullable(),
    mergedName: z.string(),
    reason: chosenOptionSchema,
  })
  .meta({ id: "PersonMergeEntry" });

/** Every status change, assignment, note, inquiry, and merge, newest first: who and when (D-020). */
export const leadTimelineSchema = z
  .object({
    items: z.array(
      z.discriminatedUnion("kind", [statusEntry, assignmentEntry, leadNoteSchema, inquirySchema, mergeEntry]),
    ),
  })
  .meta({ id: "LeadTimeline" });

/** One row of the re-care list (FR-LEAD-007). */
export const recareRowSchema = z
  .object({
    id: z.uuid(),
    leadCode: z.string(),
    fullName: z.string(),
    /** Null when hidden from the user (D-017); see maskedFields. */
    phone: z.string().nullable(),
    status: z.enum(RECARE_STATUSES),
    /** When the lead entered this status. */
    statusChangedAt: instant,
    /** The day to contact them again (a date at UTC midnight); null when none was set. */
    contactAgainOn: instant.nullable(),
    /** Its contact-again day is before the gym's today. */
    overdue: z.boolean(),
    refuseReason: chosenOptionSchema.nullable(),
    pic: person.nullable(),
    branch: branchRefSchema,
    maskedFields: z.array(z.enum(["phone"])),
  })
  .meta({ id: "RecareRow" });

/** Sorted by contact-again day, oldest first, nulls last; `overdueTotal` counts all matches that are overdue, not just this page. */
export const recarePageSchema = pageOf(recareRowSchema).extend({ overdueTotal: z.int() }).meta({ id: "RecarePage" });

/** What adding an inquiry to an existing record did (A-063). */
export const inquiryResultSchema = z
  .object({
    inquiry: inquirySchema,
    personId: z.uuid(),
    stage: z.enum(PERSON_STAGES),
    code: z.string(),
    /** A record in re-care went back to Consulting with its consultant. */
    reopened: z.boolean(),
    pic: person.nullable(),
  })
  .meta({ id: "InquiryResult" });

/** The record that remains after a merge (A-064) and the one that went to the trash. */
export const mergeResultSchema = z
  .object({ survivorId: z.uuid(), mergedId: z.uuid(), stage: z.enum(PERSON_STAGES) })
  .meta({ id: "PersonMerged" });

/** Inquiries and merges of any person record, newest first: for the customer page, which has no lead timeline. */
export const personIntakeHistorySchema = z
  .object({ items: z.array(z.discriminatedUnion("kind", [inquirySchema, mergeEntry])) })
  .meta({ id: "PersonIntakeHistory" });

/** Who may be given the lead: active users of its branch who receive leads. */
export const leadAssigneesSchema = z.object({ items: z.array(person) }).meta({ id: "LeadAssignees" });

export type Lead = z.output<typeof leadSchema>;
export type LeadPage = z.output<typeof leadPageSchema>;
export type LeadBoard = z.output<typeof leadBoardSchema>;
export type LeadTimeline = z.output<typeof leadTimelineSchema>;
export type PersonIntakeHistory = z.output<typeof personIntakeHistorySchema>;
export type RecarePage = z.output<typeof recarePageSchema>;
export type RecareRow = z.output<typeof recareRowSchema>;
export type LeadInquiry = z.output<typeof inquirySchema>;
export type LeadNote = z.output<typeof leadNoteSchema>;
export type InquiryResult = z.output<typeof inquiryResultSchema>;
export type MergeResult = z.output<typeof mergeResultSchema>;
export type LeadTimelineEntry = LeadTimeline["items"][number];
