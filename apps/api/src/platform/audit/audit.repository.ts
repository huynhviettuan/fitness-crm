import type { Db } from "../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export type AuditEntityType =
  | "user"
  | "role"
  | "branch"
  | "option"
  | "parameter"
  | "customer"
  | "contract"
  | "trainer"
  | "booking"
  | "payment"
  | "cash_transaction";

export type AuditEntry = {
  /** null only for system actions such as the initial seed. */
  actorUserId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
};

/** Must be called with the transaction that makes the change (T-022). */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorUserId: entry.actorUserId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      metadata: entry.metadata ?? {},
    },
  });
}

type JsonScalar = string | number | boolean | null;
type Changes = Record<string, { from: JsonScalar; to: JsonScalar }>;

/** The fields whose value differs, as { field: { from, to } } for audit metadata. */
export function diffFields<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): Changes {
  const changes: Changes = {};
  for (const field of fields) {
    const from = toJsonScalar(before[field]);
    const to = toJsonScalar(after[field]);
    if (from !== to) changes[field as string] = { from, to };
  }
  return changes;
}

function toJsonScalar(value: unknown): JsonScalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}
