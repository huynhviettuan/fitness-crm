import { z } from "zod";
import { chosenOptionSchema } from "../options/option.schema.js";
import { ANALYSIS_DIMENSIONS } from "./report.schema.js";

const person = z.object({ id: z.uuid(), name: z.string() });

/** The funnel and rates every row of the dashboard shows (A-089 to A-091). */
const funnel = {
  leads: z.int(),
  consulted: z.int(),
  booked: z.int(),
  showed: z.int(),
  contracted: z.int(),
  /** Booked ÷ received, in percent; null when there are no leads. */
  bookingRate: z.int().nullable(),
  /** Shown ÷ booked, in percent; null when nobody was booked. */
  showRate: z.int().nullable(),
  /** On-time steps ÷ due steps (A-082). */
  compliance: z.int().nullable(),
  /** The automatic audit's score (A-082). */
  score: z.int().nullable(),
  /** Median minutes from assignment to the first step done (A-090). */
  firstResponseMinutes: z.int().nullable(),
  recareEntered: z.int(),
  recareRebooked: z.int(),
  /** Booked again ÷ entered re-care, in percent. */
  recareRate: z.int().nullable(),
  /** How many times a lead of this person was moved on to the next consultant in the period (D-052). */
  reclaimed: z.int(),
};

const stepGroup = z.object({
  leads: z.int(),
  /** Booked ÷ the group, in percent; null for an empty group. */
  bookingRate: z.int().nullable(),
  /** Shown ÷ booked. */
  showRate: z.int().nullable(),
  /** Contracted ÷ shown. */
  contractRate: z.int().nullable(),
});

/** One step of the checklist over the cohort (D-055): how often it is done, and what became of those who did it and those who did not. */
export const stepReportSchema = z
  .object({
    key: z.string(),
    labelVi: z.string(),
    labelEn: z.string(),
    /** Leads it was due for. */
    due: z.int(),
    done: z.int(),
    onTime: z.int(),
    late: z.int(),
    /** Locked as "Không thực hiện", or past its deadline and not done. */
    notDone: z.int(),
    /** Done ÷ due, in percent; null when it was due for nobody. */
    completionRate: z.int().nullable(),
    did: stepGroup,
    didNot: stepGroup,
  })
  .meta({ id: "StepReport" });

export const consultingReportSchema = z
  .object({
    /** Null consultant: leads nobody is in charge of. */
    items: z.array(z.object({ consultant: person.nullable(), ...funnel })),
    team: z.object(funnel),
    /** The checklist's steps in their order, over the same cohort (D-055). */
    steps: z.array(stepReportSchema),
  })
  .meta({ id: "ConsultingReport" });

export const analysisBucketSchema = z
  .object({
    /** The option chosen, for lists; null for the bucket "not given" and for the fixed values. */
    option: chosenOptionSchema.omit({ note: true }).nullable(),
    /** The fixed value (ORGANIC, PAID, VIETNAM, FOREIGN); null otherwise. */
    value: z.string().nullable(),
    leads: z.int(),
    booked: z.int(),
    showed: z.int(),
    contracted: z.int(),
    bookingRate: z.int().nullable(),
    showRate: z.int().nullable(),
    /** The notes written with "Khác", most used first (FR-PLT-005); empty for any other bucket. */
    notes: z.array(z.object({ note: z.string(), count: z.int() })),
  })
  .meta({ id: "AnalysisBucket" });

export const leadAnalysisSchema = z
  .object({
    total: z.int(),
    dimensions: z.array(z.object({ dimension: z.enum(ANALYSIS_DIMENSIONS), buckets: z.array(analysisBucketSchema) })),
  })
  .meta({ id: "LeadAnalysis" });

export type ConsultingReport = z.output<typeof consultingReportSchema>;
export type ConsultingReportRow = ConsultingReport["items"][number];
export type LeadAnalysis = z.output<typeof leadAnalysisSchema>;
export type AnalysisBucket = z.output<typeof analysisBucketSchema>;
