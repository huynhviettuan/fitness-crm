import { Prisma } from "../../generated/prisma/client.js";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { MAX_REPORT_DAYS } from "@gymcrm/shared/finance";
import type { DataScopeResource, Permission } from "@gymcrm/shared/permissions";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { forbidden } from "../../platform/permissions/assert.js";
import { hasBranch, isOwnOnly } from "../../platform/permissions/scope.js";

// What the money and contract reports share (M4.7, A-139): a period in the gym's days, the branches an actor may
// see, and a refusal when the actor's data scope is "own" (a report over only some of the records would mislead).

const DAY = 86_400_000;

/** The period asked for: this month up to today when empty, and never longer than `MAX_REPORT_DAYS` days. */
export function periodOf(query: { from?: Date; to?: Date }): { from: Date; to: Date } {
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const to = query.to ?? today;
  const from = query.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  if (to < from) throw new AppError("VALIDATION_FAILED", { fieldErrors: { to: ["endBeforeStart"] } });
  if ((to.getTime() - from.getTime()) / DAY >= MAX_REPORT_DAYS) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { to: ["periodTooLong"] } });
  }
  return { from, to };
}

/** Refuses a role whose data scope for the resource is "own" (A-029). */
export function assertWholeScope(actor: Actor, resource: DataScopeResource, permission: Permission): void {
  if (isOwnOnly(actor, resource)) throw forbidden(actor, permission, "ownScope");
}

/** The branch ids a report covers: the one asked for, which the actor must have, or all of theirs. */
export function branchesOf(actor: Actor, requested: string | undefined): string[] | "ALL" {
  if (requested) {
    if (!hasBranch(actor, requested)) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { branchId: ["invalidChoice"] } });
    }
    return [requested];
  }
  return actor.branches === "ALL" ? "ALL" : [...actor.branches];
}

/** SQL for "the row's branch is among these", for the report queries written by hand. */
export function branchSql(column: Prisma.Sql, branches: string[] | "ALL"): Prisma.Sql {
  return branches === "ALL" ? Prisma.sql`TRUE` : Prisma.sql`${column} = ANY(${branches}::uuid[])`;
}
