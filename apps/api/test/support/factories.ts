import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/platform/db/prisma.js";
import { loadCurrentUser, type CurrentUser } from "../../src/platform/auth/actor.js";
import { createUserWithPassword } from "../../src/modules/users/user.repository.js";
import type { OptionListKey } from "@flow/shared/options";
import type { ApprovalAction } from "@flow/shared/approvals";

export const TEST_PASSWORD = "Test-password-123";

/** The default roles the migration creates (09_RBAC.md), by code. */
export type RoleCode =
  "ADMIN" | "FITNESS_MANAGER" | "MASTER" | "CONSULTING" | "PT" | "RECEPTIONIST" | "MARKETING" | "ACCOUNTANT";

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
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({
    id: `c0000000-0000-4000-8000-00000000000${n}`,
    labelVi: "Khác",
    labelEn: "Other",
    sortOrder: 0,
    active: true,
  })),
  { id: "c0000000-0000-4000-8000-000000000011", labelVi: "Tiền mặt", labelEn: "Cash", sortOrder: 1, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000012",
    labelVi: "Chuyển khoản",
    labelEn: "Bank transfer",
    sortOrder: 2,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-000000000013", labelVi: "Thẻ", labelEn: "Card", sortOrder: 3, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000014",
    labelVi: "Ví điện tử",
    labelEn: "E-wallet",
    sortOrder: 4,
    active: false,
  },
  // The lead profile's lists (M2 slice 1).
  { id: "c0000000-0000-4000-8000-000000000008", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  { id: "c0000000-0000-4000-8000-000000000111", labelVi: "WhatsApp", labelEn: "WhatsApp", sortOrder: 1, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000112",
    labelVi: "Messenger",
    labelEn: "Messenger",
    sortOrder: 2,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-000000000113", labelVi: "Zalo", labelEn: "Zalo", sortOrder: 3, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000114",
    labelVi: "Gọi điện",
    labelEn: "Phone call",
    sortOrder: 4,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000115",
    labelVi: "Instagram",
    labelEn: "Instagram",
    sortOrder: 5,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-000000000116", labelVi: "Threads", labelEn: "Threads", sortOrder: 6, active: true },
  { id: "c0000000-0000-4000-8000-000000000117", labelVi: "TikTok", labelEn: "TikTok", sortOrder: 7, active: true },
  { id: "c0000000-0000-4000-8000-000000000118", labelVi: "Gmail", labelEn: "Gmail", sortOrder: 8, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000119",
    labelVi: "Khách tự tìm đến Flow",
    labelEn: "Walked in to Flow",
    sortOrder: 9,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-000000000009", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  { id: "c0000000-0000-4000-8000-000000000121", labelVi: "Website", labelEn: "Website", sortOrder: 1, active: true },
  { id: "c0000000-0000-4000-8000-000000000122", labelVi: "Fanpage", labelEn: "Fanpage", sortOrder: 2, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000123",
    labelVi: "Google Ads",
    labelEn: "Google Ads",
    sortOrder: 3,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000124",
    labelVi: "Instagram",
    labelEn: "Instagram",
    sortOrder: 4,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-000000000125", labelVi: "Threads", labelEn: "Threads", sortOrder: 5, active: true },
  { id: "c0000000-0000-4000-8000-000000000126", labelVi: "TikTok", labelEn: "TikTok", sortOrder: 6, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000127",
    labelVi: "Người quen",
    labelEn: "Referral",
    sortOrder: 7,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-000000000128", labelVi: "ChatGPT", labelEn: "ChatGPT", sortOrder: 8, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000129",
    labelVi: "Google Maps",
    labelEn: "Google Maps",
    sortOrder: 9,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-00000000000a", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000131",
    labelVi: "1 - Body Transformation",
    labelEn: "1 - Body Transformation",
    sortOrder: 1,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000132",
    labelVi: "2 - Pain Relief & Better Movement",
    labelEn: "2 - Pain Relief & Better Movement",
    sortOrder: 2,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000133",
    labelVi: "3 - Energy, Longevity & Performance",
    labelEn: "3 - Energy, Longevity & Performance",
    sortOrder: 3,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000134",
    labelVi: "4 - Group Class",
    labelEn: "4 - Group Class",
    sortOrder: 4,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-00000000000b", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  { id: "c0000000-0000-4000-8000-000000000141", labelVi: "No", labelEn: "No", sortOrder: 1, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000142",
    labelVi: "2.1 (Coach)",
    labelEn: "2.1 (Coach)",
    sortOrder: 2,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000143",
    labelVi: "2.2 (Expert)",
    labelEn: "2.2 (Expert)",
    sortOrder: 3,
    active: true,
  },
  { id: "c0000000-0000-4000-8000-00000000000c", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  {
    id: "c0000000-0000-4000-8000-000000000151",
    labelVi: "Physical Assessment",
    labelEn: "Physical Assessment",
    sortOrder: 1,
    active: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000152",
    labelVi: "Pain Assessment",
    labelEn: "Pain Assessment",
    sortOrder: 2,
    active: true,
  },
  // Refusal reasons (M2 slice 2).
  { id: "c0000000-0000-4000-8000-00000000000d", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  // Customer groups (M2 slice 6).
  { id: "c0000000-0000-4000-8000-00000000000e", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  // What a manager's Fail names (M3 slice 3).
  { id: "c0000000-0000-4000-8000-00000000000f", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  // M2.7: the need details' "Khác", and the departments and job titles of the org chart (D-046, D-066).
  { id: "c0000000-0000-4000-8000-000000000010", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  { id: "c0000000-0000-4000-8000-000000000020", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  { id: "c0000000-0000-4000-8000-000000000021", labelVi: "Khác", labelEn: "Other", sortOrder: 0, active: true },
  ...[
    ["c0000000-0000-4000-8000-000000000201", "Ban điều hành", "Executive board"],
    ["c0000000-0000-4000-8000-000000000202", "Studio", "Studio"],
    ["c0000000-0000-4000-8000-000000000203", "Marketing", "Marketing"],
    ["c0000000-0000-4000-8000-000000000204", "Finance", "Finance"],
  ].map(([id, labelVi, labelEn], index) => ({ id, labelVi, labelEn, sortOrder: index + 1, active: true })),
  ...[
    ["c0000000-0000-4000-8000-000000000301", "CEO", "CEO"],
    ["c0000000-0000-4000-8000-000000000302", "Trợ lý CEO", "CEO assistant"],
    ["c0000000-0000-4000-8000-000000000303", "Studio Manager / Master", "Studio Manager / Master"],
    ["c0000000-0000-4000-8000-000000000304", "Operation Coordinator", "Operation Coordinator"],
    ["c0000000-0000-4000-8000-000000000305", "Client Care", "Client Care"],
    ["c0000000-0000-4000-8000-000000000306", "Coach Leader", "Coach Leader"],
    ["c0000000-0000-4000-8000-000000000307", "Coach Advance", "Coach Advance"],
    ["c0000000-0000-4000-8000-000000000308", "Coach Junior", "Coach Junior"],
    ["c0000000-0000-4000-8000-000000000309", "Coach Rookie", "Coach Rookie"],
    ["c0000000-0000-4000-8000-00000000030a", "Marketing Manager", "Marketing Manager"],
    ["c0000000-0000-4000-8000-00000000030b", "Content / Branding", "Content / Branding"],
    ["c0000000-0000-4000-8000-00000000030c", "Content Creator / Ads Performance", "Content Creator / Ads Performance"],
    ["c0000000-0000-4000-8000-00000000030d", "Media", "Media"],
    ["c0000000-0000-4000-8000-00000000030e", "Growth / Performance", "Growth / Performance"],
    [
      "c0000000-0000-4000-8000-00000000030f",
      "Content Creator / Branding Flow Fitness",
      "Content Creator / Branding Flow Fitness",
    ],
    [
      "c0000000-0000-4000-8000-000000000310",
      "Content Creator / Branding Flow Store",
      "Content Creator / Branding Flow Store",
    ],
    ["c0000000-0000-4000-8000-000000000311", "Media Flow Fitness", "Media Flow Fitness"],
    ["c0000000-0000-4000-8000-000000000312", "Media Flow Store", "Media Flow Store"],
    ["c0000000-0000-4000-8000-000000000313", "Direct Sale / Online Flow Fitness", "Direct Sale / Online Flow Fitness"],
    ["c0000000-0000-4000-8000-000000000314", "Sale Flow Store", "Sale Flow Store"],
    ["c0000000-0000-4000-8000-000000000315", "Kế toán trưởng", "Chief accountant"],
    ["c0000000-0000-4000-8000-000000000316", "Kế toán Flow Fitness", "Accountant Flow Fitness"],
    ["c0000000-0000-4000-8000-000000000317", "Kế toán Flow Store", "Accountant Flow Store"],
    ["c0000000-0000-4000-8000-000000000318", "Dòng tiền Store", "Store cash flow"],
    ["c0000000-0000-4000-8000-000000000319", "Kho", "Warehouse"],
  ].map(([id, labelVi, labelEn], index) => ({ id, labelVi, labelEn, sortOrder: index + 1, active: true })),
];

/** The 12 situations the migration creates (A-072), in order, with no answers. */
export const SEEDED_SCRIPTS = [
  "Chào lần đầu",
  "Hỏi mục tiêu",
  "Khách có cơn đau",
  "Mời Assessment",
  "Giá Hybrid",
  "Giá Therapy",
  "NKT",
  "Lớp nhóm",
  "Membership",
  "Thanh toán",
  "Nhắc lịch",
  "Kết thúc tư vấn",
].map((situationVi, index) => ({
  id: `e0000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, "0")}`,
  situationVi,
  sortOrder: index + 1,
}));

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
  return prisma.option
    .findFirstOrThrow({ where: { listKey, labelVi }, select: { id: true } })
    .then((option) => option.id);
}

/** An option made for a test. Removed by resetDatabase(). */
export async function createTestOption(listKey: OptionListKey, labelVi: string, active = true): Promise<string> {
  const option = await prisma.option.create({
    data: { listKey, labelVi, labelEn: labelVi, sortOrder: 100, active },
    select: { id: true },
  });
  return option.id;
}

/** A second branch, for branch-access tests. Removed by resetDatabase(). */
export function createTestBranch(name = `Chi nhánh ${randomUUID().slice(0, 8)}`) {
  return prisma.branch.create({ data: { name }, select: { id: true, name: true } });
}

/** A phone number no other test person has: a phone belongs to one person (D-019). */
export function uniquePhone(): string {
  return `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/**
 * Fixes the round-robin order of users who receive leads (BR-203): it follows when they
 * were created, so users made in the same millisecond get distinct, ascending times.
 */
export async function inRoundRobinOrder(...userIds: string[]): Promise<void> {
  for (const [index, id] of userIds.entries()) {
    await prisma.user.update({ where: { id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) } });
  }
}
