import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { GENDERS } from "../employees/employee.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
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
    /** The person in charge (PIC); assignment arrives in M2 slice 2. */
    pic: person.nullable(),
    notes: z.string().nullable(),
    createdBy: person.nullable(),
    createdAt: instant,
    maskedFields: z.array(z.enum(["phone", "email"])),
  })
  .meta({ id: "Lead" });

export const leadPageSchema = pageOf(leadSchema).meta({ id: "LeadPage" });

export type Lead = z.output<typeof leadSchema>;
export type LeadPage = z.output<typeof leadPageSchema>;
