import "server-only";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/db/prisma";
import { isUniqueViolation } from "@/lib/db/errors";
import { AppError } from "@/lib/errors/app-error";
import { assertCan } from "@/lib/permissions/assert";
import { parseInput } from "@/lib/validation/parse";
import type { Actor } from "@/lib/auth/session";
import { diffFields, recordAudit } from "@/modules/audit/audit.repository";
import * as repo from "@/modules/users/user.repository";
import {
  changeRoleSchema,
  createUserSchema,
  resetPasswordSchema,
  setLocaleSchema,
  setUserStatusSchema,
} from "@/modules/users/user.schema";

export type UserSummary = NonNullable<Awaited<ReturnType<typeof repo.findUserById>>>;

export async function listUsers(actor: Actor): Promise<UserSummary[]> {
  assertCan(actor, "user.manage");
  return repo.listUsers(prisma);
}

export async function createUser(actor: Actor, input: unknown): Promise<UserSummary> {
  assertCan(actor, "user.manage");
  const data = parseInput(createUserSchema, input);
  const passwordHash = await hashPassword(data.password);

  try {
    return await prisma.$transaction(async (tx) => {
      if (await repo.findUserByEmail(tx, data.email)) throw emailAlreadyUsed();
      const user = await repo.createUserWithPassword(tx, data, passwordHash);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "user",
        entityId: user.id,
        action: "user.created",
        metadata: { email: user.email, role: user.role },
      });
      return user;
    });
  } catch (error) {
    // Two admins creating the same email at once: the unique index decides.
    if (isUniqueViolation(error)) throw emailAlreadyUsed();
    throw error;
  }
}

export async function changeUserRole(actor: Actor, input: unknown): Promise<UserSummary> {
  assertCan(actor, "user.manage");
  const data = parseInput(changeRoleSchema, input);
  assertNotSelf(actor, data.userId);

  return prisma.$transaction(async (tx) => {
    const before = await getUserOrThrow(tx, data.userId);
    const after = await repo.updateUserRole(tx, data.userId, data.role);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: after.id,
      action: "user.role_changed",
      metadata: { changes: diffFields(before, after, ["role"]) },
    });
    return after;
  });
}

export async function setUserStatus(actor: Actor, input: unknown): Promise<UserSummary> {
  assertCan(actor, "user.manage");
  const data = parseInput(setUserStatusSchema, input);
  assertNotSelf(actor, data.userId);

  return prisma.$transaction(async (tx) => {
    const before = await getUserOrThrow(tx, data.userId);
    if (before.status === data.status) return before;

    const after = await repo.updateUserStatus(tx, data.userId, data.status);
    // A disabled user is signed out everywhere immediately (T-017).
    if (data.status === "DISABLED") await repo.deleteUserSessions(tx, data.userId);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: after.id,
      action: data.status === "DISABLED" ? "user.disabled" : "user.enabled",
      metadata: { changes: diffFields(before, after, ["status"]) },
    });
    return after;
  });
}

export async function resetUserPassword(actor: Actor, input: unknown): Promise<void> {
  assertCan(actor, "user.manage");
  const data = parseInput(resetPasswordSchema, input);
  const passwordHash = await hashPassword(data.password);

  await prisma.$transaction(async (tx) => {
    await getUserOrThrow(tx, data.userId);
    await repo.updateUserPassword(tx, data.userId, passwordHash);
    await repo.deleteUserSessions(tx, data.userId);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: data.userId,
      action: "user.password_reset",
    });
  });
}

/** Any signed-in user may choose their own UI language. */
export async function setOwnLocale(actor: Actor, input: unknown): Promise<void> {
  const data = parseInput(setLocaleSchema, input);
  await repo.updateUserLocale(prisma, actor.id, data.locale);
}

async function getUserOrThrow(db: Parameters<typeof repo.findUserById>[0], id: string) {
  const user = await repo.findUserById(db, id);
  if (!user) throw new AppError("NOT_FOUND");
  return user;
}

// Prevents an admin from locking themselves out.
function assertNotSelf(actor: Actor, userId: string) {
  if (actor.id === userId) throw new AppError("CANNOT_CHANGE_OWN_ACCESS");
}

function emailAlreadyUsed() {
  return new AppError("EMAIL_ALREADY_USED", { fieldErrors: { email: ["emailAlreadyUsed"] } });
}
