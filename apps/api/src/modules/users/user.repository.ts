import type { Db } from "../../platform/db/prisma.js";
import type { Locale, Prisma, UserStatus } from "../../generated/prisma/client.js";
import type { AccessWindow } from "@gymcrm/shared/users";

// Better Auth stores email/password credentials in an account with this provider id.
const CREDENTIAL_PROVIDER = "credential";

const userSummary = {
  id: true,
  name: true,
  email: true,
  status: true,
  locale: true,
  allBranches: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
  branches: { select: { branch: { select: { id: true, name: true } } }, orderBy: { branch: { name: "asc" } } },
} as const satisfies Prisma.UserSelect;

const userDetail = {
  ...userSummary,
  overrides: { select: { permission: true, granted: true }, orderBy: { permission: "asc" } },
  accessWindows: { select: { weekdays: true, startTime: true, endTime: true }, orderBy: { startTime: "asc" } },
} as const satisfies Prisma.UserSelect;

export type UserRecord = Prisma.UserGetPayload<{ select: typeof userSummary }>;
export type UserDetailRecord = Prisma.UserGetPayload<{ select: typeof userDetail }>;

export function listUsers(db: Db) {
  return db.user.findMany({ select: userSummary, orderBy: [{ status: "asc" }, { name: "asc" }] });
}

export function findUserById(db: Db, id: string) {
  return db.user.findUnique({ where: { id }, select: userSummary });
}

export function findUserDetail(db: Db, id: string) {
  return db.user.findUnique({ where: { id }, select: userDetail });
}

export function findUserByEmail(db: Db, email: string) {
  return db.user.findUnique({ where: { email }, select: { id: true } });
}

export async function createUserWithPassword(
  db: Db,
  data: { name: string; email: string; roleId: string; allBranches: boolean; branchIds: string[] },
  passwordHash: string,
) {
  const user = await db.user.create({
    data: {
      name: data.name,
      email: data.email,
      roleId: data.roleId,
      allBranches: data.allBranches,
      emailVerified: true,
      branches: { create: data.branchIds.map((branchId) => ({ branchId })) },
    },
    select: userSummary,
  });
  await db.authAccount.create({
    data: { userId: user.id, accountId: user.id, providerId: CREDENTIAL_PROVIDER, password: passwordHash },
  });
  return user;
}

export function updateUserRole(db: Db, id: string, roleId: string) {
  return db.user.update({ where: { id }, data: { roleId }, select: userSummary });
}

export function updateUserStatus(db: Db, id: string, status: UserStatus) {
  return db.user.update({ where: { id }, data: { status }, select: userSummary });
}

export function updateUserLocale(db: Db, id: string, locale: Locale) {
  return db.user.update({ where: { id }, data: { locale }, select: { id: true } });
}

export function updateUserPassword(db: Db, userId: string, passwordHash: string) {
  return db.authAccount.updateMany({
    where: { userId, providerId: CREDENTIAL_PROVIDER },
    data: { password: passwordHash },
  });
}

/** Replaces the user's branch grants (D-014). */
export async function replaceBranches(db: Db, userId: string, allBranches: boolean, branchIds: string[]) {
  await db.userBranch.deleteMany({ where: { userId } });
  await db.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId, branchId })) });
  return db.user.update({ where: { id: userId }, data: { allBranches }, select: userSummary });
}

/** Replaces the user's individual permission switches (FR-PLT-003). */
export async function replaceOverrides(db: Db, userId: string, overrides: { permission: string; granted: boolean }[]) {
  await db.userPermissionOverride.deleteMany({ where: { userId } });
  await db.userPermissionOverride.createMany({ data: overrides.map((o) => ({ userId, ...o })) });
}

/** Replaces the user's allowed sign-in windows (D-017). */
export async function replaceAccessWindows(db: Db, userId: string, windows: AccessWindow[]) {
  await db.userAccessWindow.deleteMany({ where: { userId } });
  await db.userAccessWindow.createMany({ data: windows.map((w) => ({ userId, ...w })) });
}

export async function listLoginEvents(db: Db, userId: string, options: { skip: number; take: number }) {
  const where = { userId };
  const [items, total] = await Promise.all([
    db.loginEvent.findMany({
      where,
      select: { id: true, at: true, success: true, reason: true, ip: true, userAgent: true },
      orderBy: { at: "desc" },
      skip: options.skip,
      take: options.take,
    }),
    db.loginEvent.count({ where }),
  ]);
  return { items, total };
}

/** Branches that exist, of those asked for. */
export function findBranches(db: Db, ids: string[]) {
  return db.branch.findMany({ where: { id: { in: ids } }, select: { id: true } });
}

export function findRole(db: Db, id: string) {
  return db.role.findUnique({ where: { id }, select: { id: true, name: true } });
}

/** Signs the user out everywhere. */
export function deleteUserSessions(db: Db, userId: string) {
  return db.authSession.deleteMany({ where: { userId } });
}
