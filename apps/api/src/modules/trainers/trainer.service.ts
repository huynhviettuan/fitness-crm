import { z } from "zod";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./trainer.repository.js";
import { listTrainersSchema, trainerInputSchema, type TrainerData } from "@flow/shared/trainers";

const AUDITED_FIELDS = ["fullName", "status", "userId"] as const;

export type TrainerView = {
  id: string;
  trainerCode: string;
  fullName: string;
  status: "ACTIVE" | "INACTIVE";
  /** The linked login (A-010), if any. */
  user: { id: string; name: string; email: string } | null;
};

export type TrainerLogin = { id: string; name: string; email: string; linkedTrainerId: string | null };

export async function listTrainers(actor: Actor, rawQuery: unknown = {}): Promise<TrainerView[]> {
  assertCan(actor, "trainer.view");
  const { activeOnly } = parseInput(listTrainersSchema, rawQuery);
  const trainers = await repo.listTrainers(prisma, activeOnly ? { status: "ACTIVE" } : {});
  return trainers.map(toView);
}

export async function createTrainer(actor: Actor, input: unknown): Promise<TrainerView> {
  assertCan(actor, "trainer.manage");
  const data = parseInput(trainerInputSchema, input);

  return withLinkConflictsMapped(() =>
    prisma.$transaction(async (tx) => {
      await assertLinkable(tx, data.userId, null);
      const trainer = await repo.createTrainer(tx, await repo.nextTrainerCode(tx), data);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "trainer",
        entityId: trainer.id,
        action: "trainer.created",
        metadata: { trainerCode: trainer.trainerCode, fullName: trainer.fullName, userId: trainer.userId },
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
      const before = await repo.findTrainer(tx, id);
      if (!before) throw new AppError("NOT_FOUND");
      await assertLinkable(tx, data.userId, id);

      const after = await repo.updateTrainer(tx, id, data);
      const changes = diffFields(before, after, AUDITED_FIELDS);
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, { actorUserId: actor.id, entityType: "trainer", entityId: id, action: "trainer.updated", metadata: { changes } });
      }
      return toView(after);
    }),
  );
}

/** Logins that can be linked to a trainer record: users with the TRAINER role (A-010). */
export async function listTrainerLogins(actor: Actor): Promise<TrainerLogin[]> {
  assertCan(actor, "trainer.manage");
  const users = await repo.listTrainerLogins(prisma);
  return users.map(({ id, name, email, trainer }) => ({ id, name, email, linkedTrainerId: trainer?.id ?? null }));
}

/** The trainer record a user signs in as (A-010), or null. */
export async function trainerIdOfUser(userId: string): Promise<string | null> {
  return (await repo.findTrainerByUserId(prisma, userId))?.id ?? null;
}

/** A-010: only a TRAINER user can be linked, and to one trainer record at most. */
async function assertLinkable(db: Db, userId: TrainerData["userId"], trainerId: string | null): Promise<void> {
  if (!userId) return;
  const user = await repo.findUserRole(db, userId);
  if (user?.role !== "TRAINER") throw linkError("userNotTrainer");
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
    fullName: trainer.fullName,
    status: trainer.status,
    user: trainer.user,
  };
}
