import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { EXERCISE_KINDS } from "./catalog.domain.js";
import { PLAN_KINDS, PLAN_STATUSES } from "./plan.domain.js";

export const planSetSchema = z.object({
  id: z.uuid(),
  setNo: z.int(),
  weight: z.number().nullable(),
  reps: z.int().nullable(),
  restSeconds: z.int().nullable(),
  rir: z.int().nullable(),
  tempo: z.string().nullable(),
  technique: z.string().nullable(),
  videoUrl: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  speed: z.number().nullable(),
  heartRate: z.int().nullable(),
  notes: z.string().nullable(),
});

export const planItemSchema = z.object({
  id: z.uuid(),
  exercise: z.object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(EXERCISE_KINDS),
    videoUrl: z.string().nullable(),
    equipmentName: z.string().nullable(),
  }),
  sets: z.array(planSetSchema),
});

export const planSessionSchema = z.object({
  id: z.uuid(),
  week: z.int().nullable(),
  number: z.int().nullable(),
  goal: z.string().nullable(),
  items: z.array(planItemSchema),
});

export const planStageSchema = z.object({
  id: z.uuid(),
  stage: z.object({ id: z.uuid(), name: z.string() }),
  sessions: z.array(planSessionSchema),
});

const person = z.object({ id: z.uuid(), name: z.string() });

/** A plan or template in a list. */
export const planSummarySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(PLAN_KINDS),
    name: z.string(),
    status: z.enum(PLAN_STATUSES),
    active: z.boolean(),
    branch: branchRefSchema,
    customer: z.object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() }).nullable(),
    contract: z.object({ id: z.uuid(), contractCode: z.string() }).nullable(),
    trainer: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }).nullable(),
    planDate: instant,
    sessions: z.int(),
    /** The plan this one replaces, while it is a revision. */
    previousPlanId: z.uuid().nullable(),
    updatedAt: instant,
  })
  .meta({ id: "WorkoutPlanSummary" });

export const planPageSchema = pageOf(planSummarySchema).meta({ id: "WorkoutPlanPage" });

/** A plan with everything under it. */
export const planSchema = planSummarySchema
  .extend({
    phase: z.string().nullable(),
    goal: z.string().nullable(),
    notes: z.string().nullable(),
    sourceTemplate: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    ptEvaluation: z.string().nullable(),
    ptNote: z.string().nullable(),
    masterEvaluation: z.string().nullable(),
    masterNote: z.string().nullable(),
    createdBy: person,
    approvedBy: person.nullable(),
    approvedAt: instant.nullable(),
    /** The plan that replaced this one, or the revision being written. */
    revisionId: z.uuid().nullable(),
    /** The request waiting for the Master, while the plan is pending. */
    pendingRequestId: z.uuid().nullable(),
    /** What the reader may do with it now (the API decides from the status and the reader's role). */
    can: z.object({
      edit: z.boolean(),
      submit: z.boolean(),
      revise: z.boolean(),
      reviewAsPt: z.boolean(),
      reviewAsMaster: z.boolean(),
    }),
    stages: z.array(planStageSchema),
  })
  .meta({ id: "WorkoutPlan" });

export type PlanSummary = z.output<typeof planSummarySchema>;
export type PlanPage = z.output<typeof planPageSchema>;
export type Plan = z.output<typeof planSchema>;
export type PlanStage = z.output<typeof planStageSchema>;
export type PlanSession = z.output<typeof planSessionSchema>;
export type PlanItem = z.output<typeof planItemSchema>;
export type PlanSet = z.output<typeof planSetSchema>;
