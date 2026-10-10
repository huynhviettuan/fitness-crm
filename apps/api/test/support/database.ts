import { prisma } from "../../src/platform/db/prisma.js";

/**
 * Removes every row the tests created. Called from the integration tests' teardown
 * hook so a failed assertion never leaves data behind for the next test.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_events", "payments", "cash_transactions", "sessions", "bookings", "trainers", "contracts", "customers", "auth_sessions",
     "auth_accounts", "auth_verifications", "auth_rate_limits", "users" CASCADE`,
  );
}
