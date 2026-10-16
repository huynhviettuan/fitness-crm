import { z } from "zod";
import { instant } from "../validation/index.js";
import { RESULT_EFFECTS, STEP_ACTIONS, STEP_STATES, STEP_TIMINGS, STEP_TRIGGERS } from "./checklist.schema.js";
import { LEAD_STATUSES } from "./lead.schema.js";

const person = z.object({ id: z.uuid(), name: z.string() });
const label = z.object({ labelVi: z.string(), labelEn: z.string() });
/** A result, and what choosing it does besides recording it. */
const result = label.extend({ effect: z.enum(RESULT_EFFECTS).nullable() });

const stepTemplate = z.object({
  key: z.string(),
  labelVi: z.string(),
  labelEn: z.string(),
  trigger: z.enum(STEP_TRIGGERS),
  triggerStatus: z.enum(LEAD_STATUSES).nullable(),
  triggerStepKey: z.string().nullable(),
  /** Minutes after the trigger; negative: before the appointment. */
  offsetMinutes: z.int(),
  required: z.boolean(),
  autoComplete: z.boolean(),
  action: z.enum(STEP_ACTIONS).nullable(),
  results: z.array(result),
});

/** The checklist new leads get (D-020). */
export const checklistSchema = z
  .object({
    version: z.int(),
    createdAt: instant,
    createdBy: person.nullable(),
    steps: z.array(stepTemplate.extend({ id: z.uuid() })),
  })
  .meta({ id: "ConsultingChecklist" });

/** One step of a lead's checklist, as of its version. */
export const leadStepSchema = stepTemplate
  .extend({
    id: z.uuid(),
    state: z.enum(STEP_STATES),
    openedAt: instant.nullable(),
    dueAt: instant.nullable(),
    /** Open and past its deadline. */
    overdue: z.boolean(),
    doneAt: instant.nullable(),
    doneBy: person.nullable(),
    result: label.nullable(),
    note: z.string().nullable(),
    timing: z.enum(STEP_TIMINGS).nullable(),
    /** When it locked as "Không thực hiện" (D-054). */
    lockedAt: instant.nullable(),
    /** Done with a result that changed nothing else, so admin may remove the tick (D-054). */
    reopenable: z.boolean(),
  })
  .meta({ id: "LeadStep" });

export const leadChecklistSchema = z
  .object({ version: z.int().nullable(), items: z.array(leadStepSchema) })
  .meta({ id: "LeadChecklist" });

/** "Việc hôm nay" (FR-LEAD-005): open steps due by the end of the gym's day, oldest deadline first. */
export const todayStepsSchema = z
  .object({
    items: z.array(
      z.object({
        step: leadStepSchema,
        lead: z.object({
          id: z.uuid(),
          leadCode: z.string(),
          fullName: z.string(),
          status: z.enum(LEAD_STATUSES),
          pic: person.nullable(),
        }),
      }),
    ),
    overdue: z.int(),
  })
  .meta({ id: "TodaySteps" });

export type Checklist = z.output<typeof checklistSchema>;
export type LeadStep = z.output<typeof leadStepSchema>;
export type LeadChecklist = z.output<typeof leadChecklistSchema>;
export type TodaySteps = z.output<typeof todayStepsSchema>;
