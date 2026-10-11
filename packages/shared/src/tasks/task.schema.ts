import { z } from "zod";
import { branchChoice } from "../branches/branch.schema.js";
import { calendarDate, hasNoControlCharacters, timeOfDay } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

/** Brief §8.2: the assignee must accept; Done and Cancelled are final. */
export const TASK_STATUSES = ["NEW", "ACCEPTED", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES = ["NEW", "ACCEPTED", "IN_PROGRESS"] as const satisfies readonly TaskStatus[];

/** Three fixed levels (A-045). */
export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Records a task can be about. Leads and sessions join when their modules are built. */
export const TASK_ENTITY_TYPES = ["customer", "contract"] as const;
export type TaskEntityType = (typeof TASK_ENTITY_TYPES)[number];

/** What a user may do with a task; the API decides and the screen shows only these. */
export const TASK_ACTIONS = ["accept", "start", "complete", "cancel", "edit", "comment"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** "" or null for none. */
const optionalId = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "invalidChoice" }).nullable(),
);

const taskFields = {
  title: text(200).pipe(z.string().min(1, { error: "required" })),
  description: text(4000).transform(emptyToNull).prefault(""),
  /** One person, or one department from the "departments" list (D-037). */
  assigneeUserId: optionalId.prefault(""),
  assigneeDepartmentId: optionalId.prefault(""),
  /** The deadline: a gym-local day and time. */
  dueDate: calendarDate,
  dueTime: timeOfDay,
  priority: z.enum(TASK_PRIORITIES, { error: "invalidChoice" }).prefault("NORMAL"),
};

function oneAssignee(
  value: { assigneeUserId: string | null; assigneeDepartmentId: string | null },
  ctx: z.RefinementCtx,
) {
  if (!value.assigneeUserId && !value.assigneeDepartmentId) {
    ctx.addIssue({ code: "custom", path: ["assigneeUserId"], message: "required" });
  } else if (value.assigneeUserId && value.assigneeDepartmentId) {
    ctx.addIssue({ code: "custom", path: ["assigneeDepartmentId"], message: "oneAssigneeOnly" });
  }
}

export const taskInputSchema = z
  .object({
    /** The branch the task belongs to (D-014). */
    branchId: branchChoice,
    ...taskFields,
    /** The record the task is about, if any: both or neither. */
    entityType: z
      .preprocess(
        (value) => (value === "" ? null : value),
        z.enum(TASK_ENTITY_TYPES, { error: "invalidChoice" }).nullable(),
      )
      .prefault(""),
    entityId: optionalId.prefault(""),
  })
  .superRefine(oneAssignee)
  .refine((value) => !value.entityType === !value.entityId, { path: ["entityId"], error: "invalidChoice" });

/** The assigner edits an open task; its branch and record stay. */
export const taskUpdateSchema = z.object(taskFields).superRefine(oneAssignee);

export const TASK_VIEWS = ["mine", "assigned", "department", "all"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const listTasksSchema = z.object({
  /** mine: given to me or waiting in my department; assigned: I gave; department: my department's; all: the "all" tasks scope. */
  view: z.enum(TASK_VIEWS, { error: "invalidChoice" }).optional().default("mine"),
  status: optional(z.enum(TASK_STATUSES, { error: "invalidChoice" })),
  /** Only open tasks past their deadline. */
  overdueOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .prefault(false),
  q: text(100).prefault(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const taskCommentSchema = z.object({
  body: text(2000).pipe(z.string().min(1, { error: "required" })),
  /** People named in the comment; each gets a notification. */
  mentions: z
    .array(z.uuid({ error: "invalidChoice" }))
    .max(20, { error: "tooLong" })
    .prefault([]),
});

export type TaskInput = z.input<typeof taskInputSchema>;
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;
export type TaskCommentInput = z.input<typeof taskCommentSchema>;
