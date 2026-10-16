import type { DataScopeResource, MaskableField } from "@gymcrm/shared/permissions";
import type { Actor } from "../auth/actor.js";
import type { Db } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";

// Branch access and data scope (D-014, D-017). Services combine these with their own
// "own" rule per resource (A-029); out-of-scope records are NOT_FOUND (docs/07).

type Scoped = Pick<Actor, "branches" | "scopes">;

/** A where-clause fragment limiting a branch-owned record to the actor's branches. */
export function inBranches(actor: Pick<Actor, "branches">): { branchId?: { in: string[] } } {
  return actor.branches === "ALL" ? {} : { branchId: { in: [...actor.branches] } };
}

export function hasBranch(actor: Pick<Actor, "branches">, branchId: string): boolean {
  return actor.branches === "ALL" || actor.branches.includes(branchId);
}

/** True when the actor's role sees only its own records of this resource. */
export function isOwnOnly(actor: Scoped, resource: DataScopeResource): boolean {
  return actor.scopes[resource] === "OWN";
}

export function isMasked(actor: Pick<Actor, "masks">, field: MaskableField): boolean {
  return actor.masks.has(field);
}

/**
 * The branch a new record goes to (D-014): the requested one, which must be active and
 * among the actor's branches, or the only active branch the actor works in.
 */
export async function resolveBranch(
  db: Db,
  actor: Pick<Actor, "branches">,
  requested: string | undefined,
): Promise<string> {
  const usable = await db.branch.findMany({
    where: { active: true, ...(actor.branches === "ALL" ? {} : { id: { in: [...actor.branches] } }) },
    select: { id: true },
  });
  if (requested) {
    if (usable.some((branch) => branch.id === requested)) return requested;
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { branchId: ["invalidChoice"] } });
  }
  if (usable.length === 1) return usable[0].id;
  throw new AppError("VALIDATION_FAILED", { fieldErrors: { branchId: ["required"] } });
}
