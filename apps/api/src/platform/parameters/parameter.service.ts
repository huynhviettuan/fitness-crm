import {
  PARAMETER_DEFAULTS,
  PARAMETER_KEYS,
  parametersInputSchema,
  type ParameterKey,
  type Parameters,
} from "@gymcrm/shared/parameters";
import { recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { prisma, type Db } from "../db/prisma.js";
import { assertCan } from "../permissions/assert.js";
import { parseInput } from "../validation/parse.js";
import { AppError } from "../errors/app-error.js";

// FR-PLT-006, T-049. A parameter without a row has its default (the brief's initial
// value). Changes apply to the next request; nothing is cached.

export async function readParameters(db: Db = prisma): Promise<Parameters> {
  const rows = await db.systemParameter.findMany({
    where: { key: { in: PARAMETER_KEYS } },
    select: { key: true, value: true },
  });
  const values: Record<ParameterKey, string> = { ...PARAMETER_DEFAULTS };
  for (const row of rows) {
    if (typeof row.value === "string") values[row.key as ParameterKey] = row.value;
  }
  return values;
}

export async function readParameter(db: Db, key: ParameterKey): Promise<string> {
  const row = await db.systemParameter.findUnique({ where: { key }, select: { value: true } });
  return typeof row?.value === "string" ? row.value : PARAMETER_DEFAULTS[key];
}

/** All values are sent; each changed one is audited with its old and new value. */
export async function updateParameters(actor: Actor, input: unknown): Promise<Parameters> {
  assertCan(actor, "config.manage");
  const data = parseInput(parametersInputSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await readParameters(tx);
    // The departments that get Báo Studio's and the failed emails' tasks must be active (not "Khác"), or none.
    for (const key of ["studioDepartmentId", "receptionDepartmentId"] as const) {
      if (!data[key] || data[key] === before[key]) continue;
      const department = await tx.option.findFirst({
        where: { id: data[key], listKey: "departments", active: true, isOther: false },
        select: { id: true },
      });
      if (!department) throw new AppError("VALIDATION_FAILED", { fieldErrors: { [key]: ["invalidChoice"] } });
    }
    for (const key of PARAMETER_KEYS) {
      if (before[key] === data[key]) continue;
      const row = await tx.systemParameter.upsert({
        where: { key },
        create: { key, value: data[key] },
        update: { value: data[key] },
      });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "parameter",
        entityId: row.id,
        action: "parameter.updated",
        before: { [key]: before[key] },
        after: { [key]: data[key] },
      });
    }
    return readParameters(tx);
  });
}
