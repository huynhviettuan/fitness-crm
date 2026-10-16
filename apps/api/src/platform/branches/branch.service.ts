import { z } from "zod";
import { branchInputSchema, type Branch } from "@gymcrm/shared/branches";
import { diffFields, recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { isUniqueViolation } from "../db/errors.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { assertCan } from "../permissions/assert.js";
import { parseInput } from "../validation/parse.js";

// FR-PLT-004, D-014. Branches are never deleted; an inactive branch takes no new
// records, and its existing records stay visible to the users who have it.

const branchSelect = { id: true, name: true, address: true, active: true } as const;

export async function listBranches(actor: Actor): Promise<Branch[]> {
  assertCan(actor, "branch.manage");
  return prisma.branch.findMany({ select: branchSelect, orderBy: [{ active: "desc" }, { name: "asc" }] });
}

export async function createBranch(actor: Actor, input: unknown): Promise<Branch> {
  assertCan(actor, "branch.manage");
  const data = parseInput(branchInputSchema, input);
  return withNameConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data, select: branchSelect });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "branch",
        entityId: branch.id,
        action: "branch.created",
        after: data,
      });
      return branch;
    }),
  );
}

export async function updateBranch(actor: Actor, id: string, input: unknown): Promise<Branch> {
  assertCan(actor, "branch.manage");
  const data = parseInput(branchInputSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return withNameConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id }, select: branchSelect });
      if (!before) throw new AppError("NOT_FOUND");
      const after = await tx.branch.update({ where: { id }, data, select: branchSelect });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "branch",
        entityId: id,
        action: "branch.updated",
        ...diffFields(before, after, ["name", "address", "active"]),
      });
      return after;
    }),
  );
}

/** The active branches a user can put new records in (D-014): for `GET /me`. */
export async function usableBranches(actor: Pick<Actor, "branches">) {
  return prisma.branch.findMany({
    where: { active: true, ...(actor.branches === "ALL" ? {} : { id: { in: [...actor.branches] } }) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

async function withNameConflictsMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { name: ["nameAlreadyUsed"] } });
    throw error;
  }
}
