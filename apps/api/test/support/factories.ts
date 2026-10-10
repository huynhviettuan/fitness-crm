import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/platform/db/prisma.js";
import type { Role } from "@flow/shared/permissions";
import type { Actor } from "../../src/platform/auth/session.js";
import { createUserWithPassword } from "../../src/modules/users/user.repository.js";

export const TEST_PASSWORD = "Test-password-123";

/** Creates a user directly in the database. Cleaned up by resetDatabase(). */
export async function createTestUser(role: Role, overrides: { name?: string; email?: string } = {}) {
  const user = await createUserWithPassword(
    prisma,
    {
      name: overrides.name ?? `${role} test user`,
      email: overrides.email ?? `${role.toLowerCase()}-${randomUUID()}@fitness-crm.test`,
      role,
    },
    await hashPassword(TEST_PASSWORD),
  );
  const actor: Actor = { id: user.id, role };
  return { user, actor };
}
