import type { Db } from "../db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { AuditEntityType } from "@flow/shared/audit";

export type { AuditEntityType };

type JsonScalar = string | number | boolean | null;

/** A record's values, as JSON: all its fields for a create or delete, the changed ones for an update. */
export type AuditValues = Record<string, unknown>;

export type AuditEntry = {
  /** null only for system actions such as the initial seed. */
  actorUserId: string | null;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  /** T-048: the values before the change; none for a create. */
  before?: AuditValues | null;
  /** The values after the change; none for a delete. */
  after?: AuditValues | null;
  /** What else explains the change, e.g. a reason or the contract it belongs to. */
  context?: Prisma.InputJsonValue;
};

/** Must be called with the transaction that makes the change (T-022, T-048). */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorUserId: entry.actorUserId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: toJson(entry.before),
      after: toJson(entry.after),
      metadata: entry.context ?? {},
    },
  });
}

/**
 * The fields whose value differs, as the `before` and `after` of an update; null when
 * nothing changed, so the caller writes no event.
 */
export function diffFields<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
): { before: AuditValues; after: AuditValues } | null {
  const changed: { before: AuditValues; after: AuditValues } = { before: {}, after: {} };
  for (const field of fields) {
    const from = toJsonScalar(before[field]);
    const to = toJsonScalar(after[field]);
    if (from === to) continue;
    changed.before[field as string] = from;
    changed.after[field as string] = to;
  }
  return Object.keys(changed.after).length > 0 ? changed : null;
}

/** Values as stored: dates as ISO strings, decimals as numbers (JSON has neither). */
function toJson(values: AuditValues | null | undefined): Prisma.InputJsonValue | undefined {
  if (!values) return undefined;
  // The replacer sees a decimal after its own toJSON (a string), so it looks at the raw value.
  const json = JSON.stringify(values, function (this: Record<string, unknown>, key: string, value: unknown) {
    return isDecimal(this[key]) ? Number(this[key]) : value;
  });
  return JSON.parse(json) as Prisma.InputJsonValue;
}

function isDecimal(value: unknown): boolean {
  return typeof value === "object" && value !== null && "toFixed" in value && "d" in value;
}

function toJsonScalar(value: unknown): JsonScalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}
