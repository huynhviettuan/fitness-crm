// Direct database access for E2E setup and teardown only. Tests never assert on it;
// they assert on what the UI shows.
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import { createUserWithPassword } from "../../apps/api/src/modules/users/user.repository";
import type { Role } from "@flow/shared/permissions";

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL is not set (see .env.example).");
  if (url === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL must not equal DATABASE_URL.");
  return url;
}

export function connect(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: e2eDatabaseUrl() }) });
}

export const E2E_PASSWORD = "E2e-password-123";

/** One account per role, shared read-only by the specs through saved sessions. */
export const E2E_USERS: Record<Role, { name: string; email: string }> = {
  ADMIN: { name: "E2E Quản trị", email: "e2e-admin@fitness-crm.test" },
  MANAGER: { name: "E2E Quản lý", email: "e2e-manager@fitness-crm.test" },
  RECEPTIONIST: { name: "E2E Lễ tân", email: "e2e-receptionist@fitness-crm.test" },
  TRAINER: { name: "E2E Huấn luyện viên", email: "e2e-trainer@fitness-crm.test" },
  ACCOUNTANT: { name: "E2E Kế toán", email: "e2e-accountant@fitness-crm.test" },
};

/** The trainer record the E2E TRAINER login is linked to (A-010). */
export const E2E_TRAINER_NAME = "E2E PT Huấn luyện";

export async function resetAndSeedUsers(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_events", "payments", "cash_transactions", "sessions", "bookings", "trainers", "contracts", "customers", "auth_sessions",
     "auth_accounts", "auth_verifications", "auth_rate_limits", "users" CASCADE`,
  );
  const passwordHash = await hashPassword(E2E_PASSWORD);
  for (const [role, user] of Object.entries(E2E_USERS) as [Role, { name: string; email: string }][]) {
    const created = await createUserWithPassword(prisma, { ...user, role }, passwordHash);
    if (role === "TRAINER") {
      const [{ value }] = await prisma.$queryRaw<{ value: bigint }[]>`SELECT nextval('trainer_code_seq') AS value`;
      await prisma.trainer.create({
        data: { trainerCode: `PT${value.toString().padStart(3, "0")}`, fullName: E2E_TRAINER_NAME, userId: created.id },
      });
    }
  }
}
