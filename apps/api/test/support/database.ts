import { prisma } from "../../src/platform/db/prisma.js";
import { DEFAULT_BRANCH_ID } from "./factories.js";

/**
 * Removes every row the tests created. Called from the integration tests' teardown
 * hook so a failed assertion never leaves data behind for the next test.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_events", "payments", "cash_transactions", "sessions", "bookings", "trainers", "contracts", "customers", "auth_sessions",
     "auth_accounts", "auth_verifications", "auth_rate_limits", "login_history", "users" CASCADE`,
  );
  // Roles and branches the tests created; the migration's defaults stay.
  await prisma.role.deleteMany({ where: { code: null } });
  await prisma.branch.deleteMany({ where: { id: { not: DEFAULT_BRANCH_ID } } });
}
