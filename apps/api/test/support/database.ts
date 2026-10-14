import { EMAIL_TEMPLATE_DEFAULTS } from "@flow/shared/mail";
import { EXTERNAL_NOTIFICATION_KINDS } from "@flow/shared/notifications";
import { prisma } from "../../src/platform/db/prisma.js";
import { DEFAULT_BRANCH_ID, SEEDED_APPROVAL_RULES, SEEDED_OPTIONS, SEEDED_SCRIPTS } from "./factories.js";

/**
 * Removes every row the tests created. Called from the integration tests' teardown
 * hook so a failed assertion never leaves data behind for the next test.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "services", "promotions", "notifications", "lead_steps", "lead_round_robin", "lead_assignments", "lead_status_changes", "task_comments", "tasks", "audit_events", "trash_entries", "approval_requests", "payments", "cash_transactions", "sessions", "bookings", "employee_days_off", "employee_shifts", "employees", "contracts", "customers", "auth_sessions",
     "auth_accounts", "auth_verifications", "auth_rate_limits", "login_history", "users" CASCADE`,
  );
  // The workout catalogs the tests made (M7.1): the migration seeds only the option lists.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "workout_exercises", "workout_areas", "workout_equipment", "workout_stages" CASCADE`,
  );
  // Checklist versions the tests saved; version 1 is the migration's (D-020).
  await prisma.consultingStepTemplate.deleteMany({ where: { checklist: { version: { gt: 1 } } } });
  await prisma.consultingChecklist.deleteMany({ where: { version: { gt: 1 } } });
  // Roles and branches the tests created; the migration's defaults stay.
  await prisma.role.deleteMany({ where: { code: null } });
  await prisma.branch.deleteMany({ where: { id: { not: DEFAULT_BRANCH_ID } } });
  // Options and parameters back to the migration's initial configuration.
  await prisma.option.deleteMany({ where: { id: { notIn: SEEDED_OPTIONS.map((option) => option.id) } } });
  for (const { id, code, ...initial } of SEEDED_OPTIONS) {
    await prisma.option.update({ where: { id }, data: { ...initial, code: code ?? null } });
  }
  await prisma.systemParameter.deleteMany();
  // The audit criteria back to all on with weight 1 (A-083).
  await prisma.auditCriterion.updateMany({ data: { active: true, weight: 1 } });
  // The script library back to the migration's 12 empty situations (A-072).
  await prisma.consultingScript.deleteMany({ where: { id: { notIn: SEEDED_SCRIPTS.map((script) => script.id) } } });
  for (const { id, situationVi, sortOrder } of SEEDED_SCRIPTS) {
    await prisma.consultingScript.update({
      where: { id },
      data: { situationVi, sortOrder, active: true, answerVi: null, answerEn: null },
    });
  }
  // The session status rules back to the brief's table (D-025).
  for (const [code, consumes, creditsPt, holdsSlot, locksOnSet, color, labelVi, labelEn] of [
    ["BOOKED", false, false, true, false, "destructive", "Booked", "Booked"],
    ["TRAINED", true, true, true, true, "info", "Đã tập", "Trained"],
    ["CANCELLED", false, false, false, false, "muted", "Hủy lịch", "Cancelled"],
    ["NO_SHOW", true, true, true, false, "warning", "Khách không đến", "No-show"],
  ] as const) {
    await prisma.sessionStatus.update({
      where: { code },
      data: { consumes, creditsPt, holdsSlot, locksOnSet, color, labelVi, labelEn },
    });
  }
  // The customer email templates back to the texts the migration starts with (M6.2).
  for (const [event, texts] of Object.entries(EMAIL_TEMPLATE_DEFAULTS)) {
    await prisma.emailTemplate.upsert({
      where: { event },
      update: { ...texts, enabled: true, updatedById: null, updatedAt: null },
      create: { event, ...texts },
    });
  }
  // Admin's mandatory marks for staff notifications back to the migration's (the truncate above clears them, M6.4).
  for (const kind of EXTERNAL_NOTIFICATION_KINDS) {
    const emailMandatory = ["taskOverdue", "approvalOverdue", "sessionHanging", "workoutEscalation"].includes(kind);
    await prisma.staffNotificationSetting.upsert({
      where: { kind },
      update: { emailMandatory, pushMandatory: false, updatedById: null, updatedAt: null },
      create: { kind, emailMandatory, pushMandatory: false },
    });
  }
  // The approval matrix back to the migration's (09_RBAC.md).
  for (const { action, required, approvers } of SEEDED_APPROVAL_RULES) {
    await prisma.approvalRule.update({ where: { actionType: action }, data: { required, overdueHours: 24 } });
    await prisma.approvalRuleRole.deleteMany({ where: { actionType: action } });
    const roles = await prisma.role.findMany({ where: { code: { in: approvers } }, select: { id: true } });
    await prisma.approvalRuleRole.createMany({ data: roles.map((role) => ({ actionType: action, roleId: role.id })) });
  }
}
