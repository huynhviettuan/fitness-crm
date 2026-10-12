// Direct database access for E2E setup and teardown only. Tests never assert on it;
// they assert on what the UI shows.
import { randomUUID } from "node:crypto";
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
    `TRUNCATE TABLE "services", "promotions", "notifications", "email_messages", "lead_steps", "lead_round_robin", "lead_assignments", "lead_status_changes", "task_comments", "tasks", "audit_events", "payments", "cash_transactions", "sessions", "bookings", "employee_days_off", "employee_shifts", "employees", "contracts", "customers", "auth_sessions",
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
 * What every contract the specs make is sold under (M4.3): a service "PT" priced 500,000 a session for 1 to 1,000
 * sessions with 60 months, so 24 sessions are "PT 24 buổi" worth 12,000,000, and a salesperson to name on it (A-115).
 * Made once, by the specs' setup, outside the API: they are configuration, not what a test is about.
 */
let fixtures: Promise<{ serviceId: string; saleEmployeeId: string }> | undefined;
export const E2E_SERVICE_NAME = "PT";
export const E2E_SALESPERSON_NAME = "Nhân viên bán hàng E2E";

export function contractFixtures() {
  fixtures ??= makeContractFixtures();
  return fixtures;
}

async function makeContractFixtures() {
  const prisma = connect();
  try {
    let service = await prisma.service.findUnique({ where: { name: E2E_SERVICE_NAME }, select: { id: true } });
    if (!service) {
      try {
        service = await prisma.service.create({
          data: {
            name: E2E_SERVICE_NAME,
            kind: "MEMBER",
            branches: { create: [{ branchId: E2E_BRANCH_ID }] },
            versions: {
              create: {
                version: 1,
                effectiveFrom: new Date("2020-01-01T00:00:00Z"),
                tiers: {
                  create: [
                    { minSessions: 1, maxSessions: 1000, unitPrice: 500_000, validityMonths: 60, validityDays: 0 },
                  ],
                },
              },
            },
            quickPackages: { create: [{ sessions: 12 }, { sessions: 24 }] },
          },
          select: { id: true },
        });
      } catch {
        // Another worker made it first.
        service = await prisma.service.findUniqueOrThrow({ where: { name: E2E_SERVICE_NAME }, select: { id: true } });
      }
    }
    let sale = await prisma.employee.findFirst({ where: { fullName: E2E_SALESPERSON_NAME }, select: { id: true } });
    if (!sale) {
      const [{ value }] = await prisma.$queryRaw<{ value: bigint }[]>`SELECT nextval('employee_code_seq') AS value`;
      sale = await prisma.employee.create({
        data: {
          employeeCode: `NV${value.toString().padStart(3, "0")}`,
          fullName: E2E_SALESPERSON_NAME,
          searchName: "nhan vien ban hang e2e",
          branchId: E2E_BRANCH_ID,
        },
        select: { id: true },
      });
    }
    return { serviceId: service.id, saleEmployeeId: sale.id };
  } finally {
    await prisma.$disconnect();
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

/** Moves a step's deadline to `minutesAgo` minutes ago, e.g. past the grace period (D-054). */
export async function setStepDue(leadId: string, key: string, minutesAgo: number): Promise<void> {
  const prisma = connect();
  try {
    await prisma.leadStep.updateMany({
      where: { customerId: leadId, template: { key }, doneAt: null },
      data: { dueAt: new Date(Date.now() - minutesAgo * 60_000) },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Setup for the customer's "Emails sent" tab (M4.0): an outbox row as the sender would have left it. There is no
 * screen that causes an email yet; the sender itself is covered by the API's integration tests. A waiting row is
 * set a day ahead, so the worker running in the E2E API does not send it while the test looks.
 */
export async function insertEmailRow(
  personId: string,
  row: { subject: string; status: "QUEUED" | "SENT" | "FAILED"; failure?: string; attempts?: number },
): Promise<void> {
  const prisma = connect();
  try {
    await prisma.emailMessage.create({
      data: {
        personId,
        branchId: E2E_BRANCH_ID,
        event: "session.credited",
        dedupeKey: `e2e:${randomUUID()}`,
        toAddress: "khach@example.com",
        locale: "vi",
        subject: row.subject,
        body: "Nội dung",
        status: row.status,
        attempts: row.attempts ?? (row.status === "QUEUED" ? 0 : 1),
        failure: row.failure ?? null,
        sentAt: row.status === "SENT" ? new Date() : null,
        nextAttemptAt: new Date(Date.now() + 24 * 3_600_000),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Puts a lead in somebody's charge directly, e.g. a manager's: not through the round-robin. */
export async function setLeadPic(leadId: string, userId: string): Promise<void> {
  const prisma = connect();
  try {
    await prisma.customer.update({ where: { id: leadId }, data: { picUserId: userId } });
  } finally {
    await prisma.$disconnect();
  }
}

/** How a lead's first consulting step ("tư vấn") stands, for the audit specs (A-081). */
export type FirstStepState = "onTime" | "late" | "openLate" | "openAhead";

export async function setFirstStep(leadId: string, state: FirstStepState): Promise<void> {
  const now = Date.now();
  const hour = 3_600_000;
  const data = {
    onTime: { dueAt: new Date(now + hour), doneAt: new Date(now), timing: "ON_TIME" as const },
    late: { dueAt: new Date(now - 2 * hour), doneAt: new Date(now), timing: "LATE" as const },
    openLate: { dueAt: new Date(now - hour), doneAt: null, timing: null },
    openAhead: { dueAt: new Date(now + hour), doneAt: null, timing: null },
  }[state];
  const prisma = connect();
  try {
    await prisma.leadStep.updateMany({ where: { customerId: leadId, template: { key: "tu-van" } }, data });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * The audit criteria are global configuration, so a spec that changes them puts back what was
 * there (A-083). Returns the function that does.
 */
export async function rememberAuditCriteria(): Promise<() => Promise<void>> {
  const prisma = connect();
  try {
    const before = await prisma.auditCriterion.findMany({ select: { key: true, active: true, weight: true } });
    return async () => {
      const again = connect();
      try {
        for (const { key, active, weight } of before) {
          await again.auditCriterion.update({ where: { key }, data: { active, weight } });
        }
      } finally {
        await again.$disconnect();
      }
    };
  } finally {
    await prisma.$disconnect();
  }
}
