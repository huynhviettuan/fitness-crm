import { z } from "zod";
import { calendarDate, instant, pageOf } from "../validation/index.js";

/** The kinds of record the action history covers (T-048). */
export const AUDIT_ENTITY_TYPES = [
  "user",
  "role",
  "branch",
  "option",
  "parameter",
  "lead",
  "customer",
  "contract",
  "employee",
  "booking",
  "payment",
  "cash_transaction",
  "approval_request",
  "approval_rule",
  "task",
  "consulting_checklist",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

const optionalDate = z
  .union([z.literal(""), calendarDate])
  .optional()
  .transform((value) => value || undefined);
/** Forms send "" for a filter left empty. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** FR-PLT-008: search by entity, record, user, and day. */
export const listAuditSchema = z.object({
  entityType: optional(z.enum(AUDIT_ENTITY_TYPES, { error: "invalidChoice" })),
  entityId: optional(z.uuid({ error: "invalidChoice" })),
  actorUserId: optional(z.uuid({ error: "invalidChoice" })),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const values = z.record(z.string(), z.unknown()).nullable();

/**
 * One change (T-048): who, when, which record, and its values before and after. A
 * create has only `after`, a delete only `before`; an update has the changed fields.
 * `context` carries what else explains the change, e.g. a reason.
 */
export const auditEventSchema = z
  .object({
    id: z.uuid(),
    at: instant,
    actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    entityType: z.string(),
    entityId: z.uuid(),
    action: z.string(),
    before: values,
    after: values,
    context: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "AuditEvent" });

export const auditPageSchema = pageOf(auditEventSchema).meta({ id: "AuditPage" });

export type AuditEvent = z.output<typeof auditEventSchema>;
