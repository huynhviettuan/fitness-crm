import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { GENDERS } from "../employees/employee.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { BOARD_STATUSES } from "./lead.domain.js";
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
    nationalityGroup: z.enum(NATIONALITY_GROUPS).nullable(),
    needGroup: chosenOptionSchema.nullable(),
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
});

/** Every status change and assignment, newest first: who and when (D-020). */
export const leadTimelineSchema = z
  .object({ items: z.array(z.discriminatedUnion("kind", [statusEntry, assignmentEntry])) })
  .meta({ id: "LeadTimeline" });

/** Who may be given the lead: active users of its branch who receive leads. */
export const leadAssigneesSchema = z.object({ items: z.array(person) }).meta({ id: "LeadAssignees" });

export type Lead = z.output<typeof leadSchema>;
export type LeadPage = z.output<typeof leadPageSchema>;
export type LeadBoard = z.output<typeof leadBoardSchema>;
export type LeadTimeline = z.output<typeof leadTimelineSchema>;
export type LeadTimelineEntry = LeadTimeline["items"][number];
