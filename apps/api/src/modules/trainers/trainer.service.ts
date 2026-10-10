import { z } from "zod";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./trainer.repository.js";
import {
  listTrainersSchema,
  trainerInputSchema,
  type Trainer as TrainerView,
  type TrainerData,
  type TrainerLogin,
} from "@flow/shared/trainers";

const AUDITED_FIELDS = ["fullName", "status", "userId", "branchId"] as const;

/** Trainers of the actor's branches (D-014). */
export async function listTrainers(actor: Actor, rawQuery: unknown = {}): Promise<TrainerView[]> {
  assertCan(actor, "trainer.view");
  const { activeOnly } = parseInput(listTrainersSchema, rawQuery);
  const trainers = await repo.listTrainers(prisma, { AND: [inBranches(actor), activeOnly ? { status: "ACTIVE" } : {}] });
  return trainers.map(toView);
}

export async function createTrainer(actor: Actor, input: unknown): Promise<TrainerView> {
  assertCan(actor, "trainer.manage");
  const data = parseInput(trainerInputSchema, input);

  return withLinkConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      await assertLinkable(tx, data.userId, null);
      const branchId = await resolveBranch(tx, actor, data.branchId);
      const trainer = await repo.createTrainer(tx, await repo.nextTrainerCode(tx), { ...data, branchId });
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "trainer",
        entityId: trainer.id,
        action: "trainer.created",
        after: { trainerCode: trainer.trainerCode, fullName: trainer.fullName, userId: trainer.userId, branchId: trainer.branch.id },
      });
      return toView(trainer);
    }),
  );
}

export async function updateTrainer(actor: Actor, id: string, input: unknown): Promise<TrainerView> {
  assertCan(actor, "trainer.manage");
  const data = parseInput(trainerInputSchema, input);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");

  return withLinkConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      const before = await repo.findTrainer(tx, id, inBranches(actor));
      if (!before) throw new AppError("NOT_FOUND");
      await assertLinkable(tx, data.userId, id);
      // Left out: the trainer stays at their branch.
      const branchId = data.branchId ? await resolveBranch(tx, actor, data.branchId) : before.branchId;

      const after = await repo.updateTrainer(tx, id, { ...data, branchId });
      const changes = diffFields(before, after, AUDITED_FIELDS);
      if (changes) {
        await recordAudit(tx, { actorUserId: actor.id, entityType: "trainer", entityId: id, action: "trainer.updated", ...changes });
      }
      return toView(after);
    }),
  );
}

/** Logins that can be linked to a trainer record (A-010): see repo.listTrainerLogins. */
export async function listTrainerLogins(actor: Actor): Promise<TrainerLogin[]> {
  assertCan(actor, "trainer.manage");
  const users = await repo.listTrainerLogins(prisma);
  return users.map(({ id, name, email, trainer }) => ({ id, name, email, linkedTrainerId: trainer?.id ?? null }));
}

/** The trainer record a user signs in as (A-010), or null. */
export async function trainerIdOfUser(userId: string): Promise<string | null> {
  return (await repo.findTrainerByUserId(prisma, userId))?.id ?? null;
}

/** A-010: only a login that acts as a trainer can be linked, and to one trainer record at most. */
async function assertLinkable(db: Db, userId: TrainerData["userId"], trainerId: string | null): Promise<void> {
  if (!userId) return;
  if (!(await repo.canActAsTrainer(db, userId))) throw linkError("userNotTrainer");
  const linked = await repo.findTrainerByUserId(db, userId);
  if (linked && linked.id !== trainerId) throw linkError("userAlreadyLinked");
}

/** Two requests linking the same login at once: the unique index decides. */
async function withLinkConflictsMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error)) throw linkError("userAlreadyLinked");
    throw error;
  }
}

function linkError(key: string): AppError {
  return new AppError("VALIDATION_FAILED", { fieldErrors: { userId: [key] } });
}

function toView(trainer: repo.TrainerRecord): TrainerView {
  return {
    id: trainer.id,
    trainerCode: trainer.trainerCode,
    branch: trainer.branch,
    fullName: trainer.fullName,
    status: trainer.status,
    user: trainer.user,
  };
}
