import type { Db } from "../../platform/db/prisma.js";
import type { Locale, UserRole, UserStatus } from "../../generated/prisma/client.js";

// Better Auth stores email/password credentials in an account with this provider id.
const CREDENTIAL_PROVIDER = "credential";

const userSummary = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  locale: true,
  createdAt: true,
} as const;

export function listUsers(db: Db) {
  return db.user.findMany({ select: userSummary, orderBy: [{ status: "asc" }, { name: "asc" }] });
}

export function findUserById(db: Db, id: string) {
  return db.user.findUnique({ where: { id }, select: userSummary });
}

export function findUserByEmail(db: Db, email: string) {
  return db.user.findUnique({ where: { email }, select: { id: true } });
}

export async function createUserWithPassword(
  db: Db,
  data: { name: string; email: string; role: UserRole },
  passwordHash: string,
) {
  const user = await db.user.create({
    data: { name: data.name, email: data.email, role: data.role, emailVerified: true },
    select: userSummary,
  });
  await db.authAccount.create({
    data: { userId: user.id, accountId: user.id, providerId: CREDENTIAL_PROVIDER, password: passwordHash },
  });
  return user;
}

export function updateUserRole(db: Db, id: string, role: UserRole) {
  return db.user.update({ where: { id }, data: { role }, select: userSummary });
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

/** Signs the user out everywhere. */
export function deleteUserSessions(db: Db, userId: string) {
  return db.authSession.deleteMany({ where: { userId } });
}
