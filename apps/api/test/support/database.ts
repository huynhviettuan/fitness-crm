import { prisma } from "../../src/platform/db/prisma.js";
import { DEFAULT_BRANCH_ID, SEEDED_APPROVAL_RULES, SEEDED_OPTIONS } from "./factories.js";

/**
 * Removes every row the tests created. Called from the integration tests' teardown
 * hook so a failed assertion never leaves data behind for the next test.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "audit_events", "trash_entries", "approval_requests", "payments", "cash_transactions", "sessions", "bookings", "employee_days_off", "employee_shifts", "employees", "contracts", "customers", "auth_sessions",
     "auth_accounts", "auth_verifications", "auth_rate_limits", "login_history", "users" CASCADE`,
  );
  // Roles and branches the tests created; the migration's defaults stay.
  await prisma.role.deleteMany({ where: { code: null } });
  await prisma.branch.deleteMany({ where: { id: { not: DEFAULT_BRANCH_ID } } });
  // Options and parameters back to the migration's initial configuration.
  await prisma.option.deleteMany({ where: { id: { notIn: SEEDED_OPTIONS.map((option) => option.id) } } });
  for (const { id, ...initial } of SEEDED_OPTIONS) {
    await prisma.option.update({ where: { id }, data: initial });
  }
  await prisma.systemParameter.deleteMany();
  // The approval matrix back to the migration's (09_RBAC.md).
  for (const { action, required, approvers } of SEEDED_APPROVAL_RULES) {
    await prisma.approvalRule.update({ where: { actionType: action }, data: { required, overdueHours: 24 } });
    await prisma.approvalRuleRole.deleteMany({ where: { actionType: action } });
    const roles = await prisma.role.findMany({ where: { code: { in: approvers } }, select: { id: true } });
    await prisma.approvalRuleRole.createMany({ data: roles.map((role) => ({ actionType: action, roleId: role.id })) });
  }
}
