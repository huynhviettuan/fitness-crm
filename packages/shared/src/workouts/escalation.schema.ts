import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema } from "../options/option.schema.js";
import { instant, pageOf } from "../validation/index.js";
import { text } from "./plan.schema.js";

// Escalation (M7.4, brief §7.4, FR-WKO-004): "Dừng + Escalation" on a set tells the manager and the Master and waits in the
// task list until one of them marks it seen with a direction.

export const ESCALATION_STATUSES = ["WAITING", "SEEN"] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/** The manager's or the Master's direction when they mark an escalation seen. */
export const escalationSeenSchema = z.object({
  direction: text(1000).pipe(z.string().min(1, { error: "required" })),
});

export const escalationListQuerySchema = z.object({
  status: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(ESCALATION_STATUSES, { error: "invalidChoice" }).optional(),
  ),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const person = z.object({ id: z.uuid(), name: z.string() });

export const escalationSchema = z
  .object({
    id: z.uuid(),
    logId: z.uuid(),
    status: z.enum(ESCALATION_STATUSES),
    branch: branchRefSchema,
    customer: z.object({ id: z.uuid(), customerCode: z.string(), fullName: z.string() }),
    trainer: z.object({ id: z.uuid(), employeeCode: z.string(), fullName: z.string() }),
    exercise: z.object({ id: z.uuid(), name: z.string() }),
    setNo: z.int(),
    flag: chosenOptionSchema,
    /** What the coach wrote against the Action and the set. */
    actionNote: z.string().nullable(),
    note: z.string().nullable(),
    raisedAt: instant,
    raisedBy: person,
    seenAt: instant.nullable(),
    seenBy: person.nullable(),
    direction: z.string().nullable(),
    /** The task in Giao việc that waits for it. */
    taskId: z.uuid().nullable(),
    /** Whether the reader may mark it seen. */
    canMarkSeen: z.boolean(),
  })
  .meta({ id: "WorkoutEscalation" });

export const escalationPageSchema = pageOf(escalationSchema).meta({ id: "WorkoutEscalationPage" });

export type Escalation = z.output<typeof escalationSchema>;
export type EscalationPage = z.output<typeof escalationPageSchema>;
export type EscalationSeenInput = z.input<typeof escalationSeenSchema>;
