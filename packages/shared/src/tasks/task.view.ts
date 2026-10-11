import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { TASK_ACTIONS, TASK_ENTITY_TYPES, TASK_PRIORITIES, TASK_STATUSES } from "./task.schema.js";

const person = z.object({ id: z.uuid(), name: z.string() });

export const taskSchema = z
  .object({
    id: z.uuid(),
    branch: branchRefSchema,
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    dueAt: instant,
    /** Still open after its deadline. */
    overdue: z.boolean(),
    assigner: person,
    /** The person doing it; null while a department's task waits for someone to accept it. */
    assignee: person.nullable(),
    department: chosenOptionSchema.nullable(),
    /** The record it is about, with a label to show. */
    entity: z.object({ type: z.enum(TASK_ENTITY_TYPES), id: z.uuid(), label: z.string() }).nullable(),
    createdAt: instant,
    acceptedAt: instant.nullable(),
    doneAt: instant.nullable(),
    cancelledAt: instant.nullable(),
    /** What the signed-in user may do with it now. */
    actions: z.array(z.enum(TASK_ACTIONS)),
  })
  .meta({ id: "Task" });

export const taskPageSchema = pageOf(taskSchema).meta({ id: "TaskPage" });

export const taskCommentViewSchema = z
  .object({ id: z.uuid(), author: person, body: z.string(), mentions: z.array(person), createdAt: instant })
  .meta({ id: "TaskComment" });

export const taskDetailSchema = taskSchema
  .extend({ comments: z.array(taskCommentViewSchema) })
  .meta({ id: "TaskDetail" });

/** Who a task can go to in the user's branches: active people, and departments. */
export const taskAssigneesSchema = z
  .object({
    users: z.array(person.extend({ department: chosenOptionSchema.nullable() })),
    departments: z.array(z.object({ id: z.uuid(), labelVi: z.string(), labelEn: z.string(), isOther: z.boolean() })),
  })
  .meta({ id: "TaskAssignees" });

/** "Việc của tôi" at a glance: open tasks of mine and how many are overdue. */
export const taskSummarySchema = z.object({ open: z.int(), overdue: z.int() }).meta({ id: "TaskSummary" });

export type Task = z.output<typeof taskSchema>;
export type TaskDetail = z.output<typeof taskDetailSchema>;
export type TaskAssignees = z.output<typeof taskAssigneesSchema>;
export type TaskSummary = z.output<typeof taskSummarySchema>;
