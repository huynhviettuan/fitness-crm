import type { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../../platform/auth/session.js";
import { inBranches, isOwnOnly } from "../../platform/permissions/scope.js";

/** The logs an actor may see: their branches', and for a PT the sessions they teach or the customers they created. */
export function logsVisibleTo(actor: Actor): Prisma.WorkoutLogWhereInput {
  const own: Prisma.WorkoutLogWhereInput = {
    OR: [...(actor.employeeId ? [{ trainerId: actor.employeeId }] : []), { customer: { createdById: actor.id } }],
  };
  return { AND: [inBranches(actor), isOwnOnly(actor, "schedule") ? own : {}] };
}
