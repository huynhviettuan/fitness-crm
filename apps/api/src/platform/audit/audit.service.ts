import { listAuditSchema, type AuditEvent } from "@gymcrm/shared/audit";
import type { MaskableField } from "@gymcrm/shared/permissions";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../auth/session.js";
import { prisma } from "../db/prisma.js";
import { assertCan } from "../permissions/assert.js";
import { isMasked } from "../permissions/scope.js";
import { parseInput } from "../validation/parse.js";
import { gymDaysRange } from "../time/gym-days.js";

// The action history (FR-PLT-008, T-048): every change with its values before and
// after. Read-only; the application has no path to change or remove an event (T-022).

/** Fields hidden from a role (D-017) are hidden in the history too. */
const MASKED_VALUES: { entityType: string; key: string; field: MaskableField }[] = [
  { entityType: "customer", key: "phone", field: "customer.phone" },
  { entityType: "customer", key: "email", field: "customer.email" },
];

export async function listAuditEvents(
  actor: Actor,
  rawQuery: unknown,
): Promise<{ items: AuditEvent[]; total: number; page: number; pageSize: number }> {
  assertCan(actor, "audit.view");
  const query = parseInput(listAuditSchema, rawQuery);
  const where: Prisma.AuditEventWhereInput = {
    entityType: query.entityType,
    entityId: query.entityId,
    actorUserId: query.actorUserId,
    createdAt: gymDaysRange(query.from, query.to),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);
  const hidden = MASKED_VALUES.filter((mask) => isMasked(actor, mask.field));
  const mask = (entityType: string, values: Prisma.JsonValue | null) => {
    if (!values || typeof values !== "object" || Array.isArray(values))
      return values === null ? null : { value: values };
    const keys = hidden.filter((h) => h.entityType === entityType).map((h) => h.key);
    return Object.fromEntries(Object.entries(values).filter(([key]) => !keys.includes(key)));
  };
  const items = rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    before: mask(row.entityType, row.before),
    after: mask(row.entityType, row.after),
    context: (row.metadata ?? {}) as Record<string, unknown>,
  }));
  return { items, total, page: query.page, pageSize: query.pageSize };
}
