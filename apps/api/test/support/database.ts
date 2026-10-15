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
  // Options and parameters back to the migration's initial configuration. Each table below is put back with one statement
  // from a JSON list, not one update per row: the reset runs after every test, and round trips were most of its time.
  await prisma.option.deleteMany({ where: { id: { notIn: SEEDED_OPTIONS.map((option) => option.id) } } });
  await restore(
    `UPDATE "options" AS o SET label_vi = v."labelVi", label_en = v."labelEn", sort_order = v."sortOrder", active = v.active,
       code = v.code, updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, "labelVi" text, "labelEn" text, "sortOrder" int, active boolean, code text)
     WHERE o.id = v.id`,
    SEEDED_OPTIONS.map(({ code, ...option }) => ({ ...option, code: code ?? null })),
  );
  await prisma.systemParameter.deleteMany();
  // The audit criteria back to all on with weight 1 (A-083).
  await prisma.auditCriterion.updateMany({ data: { active: true, weight: 1 } });
  // The script library back to the migration's 12 empty situations (A-072).
  await prisma.consultingScript.deleteMany({ where: { id: { notIn: SEEDED_SCRIPTS.map((script) => script.id) } } });
  await restore(
    `UPDATE "consulting_scripts" AS c SET situation_vi = v."situationVi", sort_order = v."sortOrder", active = true,
       answer_vi = NULL, answer_en = NULL, updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, "situationVi" text, "sortOrder" int)
     WHERE c.id = v.id`,
    SEEDED_SCRIPTS.map(({ id, situationVi, sortOrder }) => ({ id, situationVi, sortOrder })),
  );
  // The session status rules back to the brief's table (D-025).
  await restore(
    `UPDATE "session_statuses" AS s SET consumes = v.consumes, credits_pt = v."creditsPt", holds_slot = v."holdsSlot",
       locks_on_set = v."locksOnSet", color = v.color, label_vi = v."labelVi", label_en = v."labelEn", updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS v(code text, consumes boolean, "creditsPt" boolean, "holdsSlot" boolean,
       "locksOnSet" boolean, color text, "labelVi" text, "labelEn" text)
     WHERE s.code = v.code`,
    [
      ["BOOKED", false, false, true, false, "destructive", "Booked", "Booked"],
      ["TRAINED", true, true, true, true, "info", "Đã tập", "Trained"],
      ["CANCELLED", false, false, false, false, "muted", "Hủy lịch", "Cancelled"],
      ["NO_SHOW", true, true, true, false, "warning", "Khách không đến", "No-show"],
    ].map(([code, consumes, creditsPt, holdsSlot, locksOnSet, color, labelVi, labelEn]) => ({
      code,
      consumes,
      creditsPt,
      holdsSlot,
      locksOnSet,
      color,
      labelVi,
      labelEn,
    })),
  );
  // The customer email templates back to the texts the migration starts with (M6.2).
  await restore(
    `INSERT INTO "email_templates" (event, subject_vi, body_vi, subject_en, body_en)
     SELECT v.event, v."subjectVi", v."bodyVi", v."subjectEn", v."bodyEn"
     FROM jsonb_to_recordset($1::jsonb) AS v(event text, "subjectVi" text, "bodyVi" text, "subjectEn" text, "bodyEn" text)
     ON CONFLICT (event) DO UPDATE SET subject_vi = EXCLUDED.subject_vi, body_vi = EXCLUDED.body_vi,
       subject_en = EXCLUDED.subject_en, body_en = EXCLUDED.body_en, enabled = true, updated_by = NULL, updated_at = NULL`,
    Object.entries(EMAIL_TEMPLATE_DEFAULTS).map(([event, texts]) => ({ event, ...texts })),
  );
  // Admin's mandatory marks for staff notifications back to the migration's (the truncate above clears them, M6.4).
  await restore(
    `INSERT INTO "staff_notification_settings" (kind, email_mandatory, push_mandatory)
     SELECT v.kind, v."emailMandatory", false FROM jsonb_to_recordset($1::jsonb) AS v(kind text, "emailMandatory" boolean)
     ON CONFLICT (kind) DO UPDATE SET email_mandatory = EXCLUDED.email_mandatory, push_mandatory = false,
       updated_by = NULL, updated_at = NULL`,
    EXTERNAL_NOTIFICATION_KINDS.map((kind) => ({
      kind,
      emailMandatory: ["taskOverdue", "approvalOverdue", "sessionHanging", "workoutEscalation"].includes(kind),
    })),
  );
  // The approval matrix back to the migration's (09_RBAC.md).
  const rules = SEEDED_APPROVAL_RULES.map(({ action, required, approvers }) => ({ action, required, approvers }));
  await restore(
    `UPDATE "approval_rules" AS r SET required = v.required, overdue_hours = 24, updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS v(action text, required boolean) WHERE r.action_type = v.action`,
    rules,
  );
  await restore(
    `DELETE FROM "approval_rule_roles" WHERE action_type IN (SELECT v.action FROM jsonb_to_recordset($1::jsonb) AS v(action text))`,
    rules,
  );
  await restore(
    `INSERT INTO "approval_rule_roles" (action_type, role_id)
     SELECT v.action, role.id FROM jsonb_to_recordset($1::jsonb) AS v(action text, approvers text[])
     JOIN "roles" AS role ON role.code = ANY (v.approvers)`,
    rules,
  );
}

/** Runs one statement over a JSON list of rows (`$1`). */
async function restore(sql: string, rows: unknown[]): Promise<void> {
  await prisma.$executeRawUnsafe(sql, JSON.stringify(rows));
}
