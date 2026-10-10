import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/platform/db/prisma.js";
import { loadCurrentUser, type CurrentUser } from "../../src/platform/auth/actor.js";
import { createUserWithPassword } from "../../src/modules/users/user.repository.js";

export const TEST_PASSWORD = "Test-password-123";

/** The default roles the migration creates (09_RBAC.md), by code. */
export type RoleCode = "ADMIN" | "FITNESS_MANAGER" | "MASTER" | "CONSULTING" | "PT" | "RECEPTIONIST" | "MARKETING" | "ACCOUNTANT";

/** The branch the migration creates; every test record goes there unless a test says otherwise. */
export const DEFAULT_BRANCH_ID = "b0000000-0000-4000-8000-000000000001";

export function roleId(code: RoleCode): Promise<string> {
  return prisma.role.findUniqueOrThrow({ where: { code }, select: { id: true } }).then((role) => role.id);
}

/** The actor exactly as the API builds it for a request. */
export async function actorOf(userId: string): Promise<CurrentUser> {
  const actor = await loadCurrentUser(prisma, userId);
  if (!actor) throw new Error(`No user ${userId}`);
  return actor;
}

/** Creates a user directly in the database. Cleaned up by resetDatabase(). */
export async function createTestUser(
  role: RoleCode,
  overrides: { name?: string; email?: string; branchIds?: string[]; allBranches?: boolean; roleId?: string } = {},
) {
  const user = await createUserWithPassword(
    prisma,
    {
      name: overrides.name ?? `${role} test user`,
      email: overrides.email ?? `${role.toLowerCase()}-${randomUUID()}@fitness-crm.test`,
      roleId: overrides.roleId ?? (await roleId(role)),
      allBranches: overrides.allBranches ?? false,
      branchIds: overrides.branchIds ?? [DEFAULT_BRANCH_ID],
    },
    await hashPassword(TEST_PASSWORD),
  );
  return { user, actor: await actorOf(user.id) };
}

/** A second branch, for branch-access tests. Removed by resetDatabase(). */
export function createTestBranch(name = `Chi nhánh ${randomUUID().slice(0, 8)}`) {
  return prisma.branch.create({ data: { name }, select: { id: true, name: true } });
}
