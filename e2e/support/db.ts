// Direct database access for E2E setup and teardown only. Tests never assert on it;
// they assert on what the UI shows.
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client";
import { createUserWithPassword } from "../../apps/api/src/modules/users/user.repository";

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

/** The default roles the specs sign in with (09_RBAC.md), by code. */
export type Role = "ADMIN" | "FITNESS_MANAGER" | "RECEPTIONIST" | "PT" | "ACCOUNTANT" | "CONSULTING";

/** One account per role, shared read-only by the specs through saved sessions. */
export const E2E_USERS: Record<Role, { name: string; email: string }> = {
  ADMIN: { name: "E2E Quản trị", email: "e2e-admin@fitness-crm.test" },
  FITNESS_MANAGER: { name: "E2E Quản lý", email: "e2e-manager@fitness-crm.test" },
  RECEPTIONIST: { name: "E2E Lễ tân", email: "e2e-receptionist@fitness-crm.test" },
  PT: { name: "E2E Huấn luyện viên", email: "e2e-trainer@fitness-crm.test" },
  ACCOUNTANT: { name: "E2E Kế toán", email: "e2e-accountant@fitness-crm.test" },
  CONSULTING: { name: "E2E Tư vấn", email: "e2e-consulting@fitness-crm.test" },
};

/** The branch the migration creates; every E2E record goes there. */
export const E2E_BRANCH_ID = "b0000000-0000-4000-8000-000000000001";

/** The employee the E2E PT login belongs to (brief §8.4); teaches PT every day, all day. */
export const E2E_TRAINER_NAME = "E2E PT Huấn luyện";

export async function resetAndSeedUsers(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "notifications", "lead_steps", "lead_round_robin", "lead_assignments", "lead_status_changes", "task_comments", "tasks", "audit_events", "payments", "cash_transactions", "sessions", "bookings", "employee_days_off", "employee_shifts", "employees", "contracts", "customers", "auth_sessions",
     "auth_accounts", "auth_verifications", "auth_rate_limits", "login_history", "users" CASCADE`,
  );
  // Checklist versions the specs saved; version 1 is the migration's (D-020).
  await prisma.consultingStepTemplate.deleteMany({ where: { checklist: { version: { gt: 1 } } } });
  await prisma.consultingChecklist.deleteMany({ where: { version: { gt: 1 } } });
  // Roles and branches the specs created; the migration's defaults stay.
  await prisma.role.deleteMany({ where: { code: null } });
  await prisma.branch.deleteMany({ where: { id: { not: E2E_BRANCH_ID } } });
  const passwordHash = await hashPassword(E2E_PASSWORD);
  for (const [role, user] of Object.entries(E2E_USERS) as [Role, { name: string; email: string }][]) {
    const { id: roleId } = await prisma.role.findUniqueOrThrow({ where: { code: role }, select: { id: true } });
    const created = await createUserWithPassword(
      prisma,
      { ...user, roleId, allBranches: role === "ADMIN", branchIds: [E2E_BRANCH_ID] },
      passwordHash,
    );
    if (role === "PT") {
      const [{ value }] = await prisma.$queryRaw<{ value: bigint }[]>`SELECT nextval('employee_code_seq') AS value`;
      await prisma.employee.create({
        data: {
          employeeCode: `NV${value.toString().padStart(3, "0")}`,
          fullName: E2E_TRAINER_NAME,
          searchName: "e2e pt huan luyen",
          isTrainer: true,
          userId: created.id,
          branchId: E2E_BRANCH_ID,
          shifts: { create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 24 * 60 })) },
        },
      });
    }
  }
}

/**
 * Setup for "Việc hôm nay": makes one of a lead's open consulting steps due now, so the
 * test does not depend on the time of day (a step due in an hour may fall after midnight).
 */
export async function makeStepDueNow(leadId: string, key: string): Promise<void> {
  const prisma = connect();
  try {
    await prisma.leadStep.updateMany({
      where: { customerId: leadId, template: { key }, doneAt: null },
      data: { dueAt: new Date() },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Setup for the re-care list: sets the day a lead in re-care is due to be contacted again
 * (a gym date, `YYYY-MM-DD`; null for none), so ordering and "overdue" do not depend on
 * today's date.
 */
export async function setContactAgainOn(leadId: string, day: string | null): Promise<void> {
  const prisma = connect();
  try {
    await prisma.customer.update({
      where: { id: leadId },
      data: { contactAgainOn: day ? new Date(`${day}T00:00:00Z`) : null },
    });
  } finally {
    await prisma.$disconnect();
  }
}
