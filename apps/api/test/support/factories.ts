import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/platform/db/prisma.js";
import { loadCurrentUser, type CurrentUser } from "../../src/platform/auth/actor.js";
import { createUserWithPassword } from "../../src/modules/users/user.repository.js";
import type { OptionListKey } from "@flow/shared/options";
import type { ApprovalAction } from "@flow/shared/approvals";

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

/** The options the migration creates (D-016, brief §8.1), as they are initially. */
export const SEEDED_OPTIONS: { id: string; labelVi: string; labelEn: string; sortOrder: number; active: boolean }[] = [
  ...[1, 2, 3, 4].map((n) => ({ id: `c0000000-0000-4000-8000-00000000000${n}`, labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true })),
  { id: "c0000000-0000-4000-8000-000000000011", labelVi: "Tiền mặt", labelEn: "Cash", sortOrder: 1, active: true },
  { id: "c0000000-0000-4000-8000-000000000012", labelVi: "Chuyển khoản", labelEn: "Bank transfer", sortOrder: 2, active: true },
  { id: "c0000000-0000-4000-8000-000000000013", labelVi: "Thẻ", labelEn: "Card", sortOrder: 3, active: true },
  { id: "c0000000-0000-4000-8000-000000000014", labelVi: "Ví điện tử", labelEn: "E-wallet", sortOrder: 4, active: false },
  { id: "c0000000-0000-4000-8000-000000000005", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
];

/** The approval matrix the migration creates (09_RBAC.md). */
export const SEEDED_APPROVAL_RULES: { action: ApprovalAction; required: boolean; approvers: RoleCode[] }[] = [
  { action: "payment.create", required: true, approvers: ["FITNESS_MANAGER", "ADMIN"] },
  { action: "cash.create", required: true, approvers: ["FITNESS_MANAGER", "ADMIN"] },
  { action: "record.delete", required: true, approvers: ["ADMIN"] },
  { action: "customer.identity", required: true, approvers: ["FITNESS_MANAGER"] },
];

/**
 * Switches the approval matrix off, for tests about something else (payments, debt,
 * deletion). resetDatabase() switches it back on.
 */
export async function withoutApprovals(): Promise<void> {
  await prisma.approvalRule.updateMany({ data: { required: false } });
}

/** An option's id by its Vietnamese label; "Khác" is each list's Other. */
export function optionId(listKey: OptionListKey, labelVi: string): Promise<string> {
  return prisma.option.findFirstOrThrow({ where: { listKey, labelVi }, select: { id: true } }).then((option) => option.id);
}

/** An option made for a test. Removed by resetDatabase(). */
export async function createTestOption(listKey: OptionListKey, labelVi: string, active = true): Promise<string> {
  const option = await prisma.option.create({ data: { listKey, labelVi, labelEn: labelVi, sortOrder: 100, active }, select: { id: true } });
  return option.id;
}

/** A second branch, for branch-access tests. Removed by resetDatabase(). */
export function createTestBranch(name = `Chi nhánh ${randomUUID().slice(0, 8)}`) {
  return prisma.branch.create({ data: { name }, select: { id: true, name: true } });
}
