import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import * as repo from "./user.repository.js";
import { isPermission } from "@gymcrm/shared/permissions";
import {
  changeRoleSchema,
  createUserSchema,
  loginHistoryQuerySchema,
  resetPasswordSchema,
  setAccessWindowsSchema,
  setLocaleSchema,
  setOverridesSchema,
  setUserBranchesSchema,
  setUserStatusSchema,
  type LoginEvent,
  type User,
  type UserDetail,
} from "@gymcrm/shared/users";

export async function listUsers(actor: Actor): Promise<User[]> {
  assertCan(actor, "user.manage");
  return (await repo.listUsers(prisma)).map(toUser);
}

/** A user with their overrides and access hours (FR-PLT-001). */
export async function getUser(actor: Actor, id: string): Promise<UserDetail> {
  assertCan(actor, "user.manage");
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const user = await repo.findUserDetail(prisma, id);
  if (!user) throw new AppError("NOT_FOUND");
  return {
    ...toUser(user),
    // Keys no longer in the catalog are ignored, as when loading the actor.
    overrides: user.overrides.filter((o): o is UserDetail["overrides"][number] => isPermission(o.permission)),
    accessWindows: user.accessWindows as UserDetail["accessWindows"],
  };
}

export async function createUser(actor: Actor, input: unknown): Promise<User> {
  assertCan(actor, "user.manage");
  const data = parseInput(createUserSchema, input);
  const passwordHash = await hashPassword(data.password);

  try {
    return await prisma.$transaction(async (tx) => {
      if (await repo.findUserByEmail(tx, data.email)) throw emailAlreadyUsed();
      await assertRoleExists(tx, data.roleId);
      await assertBranchesExist(tx, data.branchIds);
      const user = await repo.createUserWithPassword(tx, data, passwordHash);
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "user",
        entityId: user.id,
        action: "user.created",
        after: {
          name: user.name,
          email: user.email,
          roleId: user.role.id,
          allBranches: data.allBranches,
          branchIds: data.branchIds,
        },
      });
      return toUser(user);
    });
  } catch (error) {
    // Two admins creating the same email at once: the unique index decides.
    if (isUniqueViolation(error)) throw emailAlreadyUsed();
    throw error;
  }
}

export async function changeUserRole(actor: Actor, input: unknown): Promise<User> {
  assertCan(actor, "user.manage");
  const data = parseInput(changeRoleSchema, input);
  assertNotSelf(actor, data.userId);

  return prisma.$transaction(async (tx) => {
    const before = await getUserOrThrow(tx, data.userId);
    await assertRoleExists(tx, data.roleId);
    const after = await repo.updateUserRole(tx, data.userId, data.roleId);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: after.id,
      action: "user.role_changed",
      before: { roleId: before.role.id },
      after: { roleId: after.role.id },
    });
    return toUser(after);
  });
}

export async function setUserStatus(actor: Actor, input: unknown): Promise<User> {
  assertCan(actor, "user.manage");
  const data = parseInput(setUserStatusSchema, input);
  assertNotSelf(actor, data.userId);

  return prisma.$transaction(async (tx) => {
    const before = await getUserOrThrow(tx, data.userId);
    if (before.status === data.status) return toUser(before);

    const after = await repo.updateUserStatus(tx, data.userId, data.status);
    // A disabled user is signed out everywhere immediately (T-017).
    if (data.status === "DISABLED") await repo.deleteUserSessions(tx, data.userId);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: after.id,
      action: data.status === "DISABLED" ? "user.disabled" : "user.enabled",
      ...diffFields(before, after, ["status"]),
    });
    return toUser(after);
  });
}

/** D-014: every branch, or the granted ones. Takes effect on the user's next request. */
export async function setUserBranches(actor: Actor, input: unknown): Promise<User> {
  assertCan(actor, "user.manage");
  const data = parseInput(setUserBranchesSchema, input);
  assertNotSelf(actor, data.userId);

  return prisma.$transaction(async (tx) => {
    const before = await getUserOrThrow(tx, data.userId);
    await assertBranchesExist(tx, data.branchIds);
    const after = await repo.replaceBranches(tx, data.userId, data.allBranches, data.branchIds);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: data.userId,
      action: "user.branches_changed",
      before: { allBranches: before.allBranches, branchIds: before.branches.map((b) => b.branch.id) },
      after: { allBranches: data.allBranches, branchIds: data.branchIds },
    });
    return toUser(after);
  });
}

/** FR-PLT-003: single permissions switched on or off for one user. */
export async function setUserOverrides(actor: Actor, input: unknown): Promise<UserDetail> {
  assertCan(actor, "user.manage");
  const data = parseInput(setOverridesSchema, input);
  assertNotSelf(actor, data.userId);

  await prisma.$transaction(async (tx) => {
    const before = await repo.findUserDetail(tx, data.userId);
    if (!before) throw new AppError("NOT_FOUND");
    await repo.replaceOverrides(tx, data.userId, data.overrides);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: data.userId,
      action: "user.overrides_changed",
      before: { overrides: before.overrides },
      after: { overrides: data.overrides },
    });
  });
  return getUser(actor, data.userId);
}

/** D-017: allowed sign-in days and times; an empty list means any time. */
export async function setUserAccessWindows(actor: Actor, input: unknown): Promise<UserDetail> {
  assertCan(actor, "user.manage");
  const data = parseInput(setAccessWindowsSchema, input);
  assertNotSelf(actor, data.userId);

  await prisma.$transaction(async (tx) => {
    const before = await repo.findUserDetail(tx, data.userId);
    if (!before) throw new AppError("NOT_FOUND");
    await repo.replaceAccessWindows(tx, data.userId, data.windows);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "user",
      entityId: data.userId,
      action: "user.access_hours_changed",
      before: { windows: before.accessWindows },
      after: { windows: data.windows },
    });
  });
  return getUser(actor, data.userId);
}

/** D-017: every sign-in attempt, newest first. */
export async function listLoginHistory(
  actor: Actor,
  userId: string,
  rawQuery: unknown,
): Promise<{ items: LoginEvent[]; total: number; page: number; pageSize: number }> {
  assertCan(actor, "user.manage");
  const query = parseInput(loginHistoryQuerySchema, rawQuery);
  if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND");
  await getUserOrThrow(prisma, userId);
  const { items, total } = await repo.listLoginEvents(prisma, userId, {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { items, total, page: query.page, pageSize: query.pageSize };
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

function toUser(user: repo.UserRecord): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    locale: user.locale,
    allBranches: user.allBranches,
    branches: user.branches.map((b) => b.branch),
    createdAt: user.createdAt,
  };
}

async function getUserOrThrow(db: Db, id: string) {
  const user = await repo.findUserById(db, id);
  if (!user) throw new AppError("NOT_FOUND");
  return user;
}

async function assertRoleExists(db: Db, roleId: string) {
  if (!(await repo.findRole(db, roleId)))
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { roleId: ["invalidChoice"] } });
}

async function assertBranchesExist(db: Db, branchIds: string[]) {
  if ((await repo.findBranches(db, branchIds)).length !== branchIds.length) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { branchIds: ["invalidChoice"] } });
  }
}

// Prevents an admin from locking themselves out.
function assertNotSelf(actor: Actor, userId: string) {
  if (actor.id === userId) throw new AppError("CANNOT_CHANGE_OWN_ACCESS");
}

function emailAlreadyUsed() {
  return new AppError("EMAIL_ALREADY_USED", { fieldErrors: { email: ["emailAlreadyUsed"] } });
}
