-- M1 slice 5: approvals (D-018). The matrix, the requests, and the approval status of
-- receipts and cash entries. Existing records were recorded without approval and stay
-- in effect (APPROVED).

CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "payments" ADD COLUMN "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "cash_transactions" ADD COLUMN "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED';
-- A record is PENDING, APPROVED, or REJECTED; CANCELLED is only for requests.
ALTER TABLE "payments" ADD CONSTRAINT "payments_approval_status_valid" CHECK ("approval_status" <> 'CANCELLED');
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_approval_status_valid" CHECK ("approval_status" <> 'CANCELLED');

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action_type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "overdue_hours" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_rules_overdue_hours_range" CHECK ("overdue_hours" BETWEEN 1 AND 720)
);

CREATE UNIQUE INDEX "approval_rules_action_type_key" ON "approval_rules"("action_type");

-- CreateTable
CREATE TABLE "approval_rule_roles" (
    "action_type" TEXT NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "approval_rule_roles_pkey" PRIMARY KEY ("action_type","role_id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "action_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,0),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reject_reason_option_id" UUID,
    "reject_reason_note" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_requests_status_action_type_idx" ON "approval_requests"("status", "action_type");
CREATE INDEX "approval_requests_entity_id_idx" ON "approval_requests"("entity_id");

-- AddForeignKey
ALTER TABLE "approval_rule_roles" ADD CONSTRAINT "approval_rule_roles_action_type_fkey" FOREIGN KEY ("action_type") REFERENCES "approval_rules"("action_type") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_rule_roles" ADD CONSTRAINT "approval_rule_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reject_reason_option_id_fkey" FOREIGN KEY ("reject_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customized (not modeled by Prisma).
-- D-018: nobody decides their own request.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_not_own" CHECK ("decided_by" IS NULL OR "decided_by" <> "submitted_by");
-- A decision is complete: approved and rejected requests name who and when; a
-- rejection has its reason; only a pending request has no decision time.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_complete" CHECK (
    ("status" IN ('APPROVED', 'REJECTED')) = ("decided_by" IS NOT NULL)
    AND ("status" = 'PENDING') = ("decided_at" IS NULL)
    AND ("status" = 'REJECTED') = ("reject_reason_option_id" IS NOT NULL)
);
-- One pending request per record and action, also under concurrent submissions.
CREATE UNIQUE INDEX "approval_requests_one_pending" ON "approval_requests"("action_type", "entity_id") WHERE "status" = 'PENDING';

-- The initial matrix (09_RBAC.md); admin changes it on screen.
INSERT INTO "approval_rules" ("action_type", "required", "overdue_hours") VALUES
    ('payment.create', true, 24),
    ('cash.create', true, 24),
    ('record.delete', true, 24),
    ('customer.identity', true, 24);
INSERT INTO "approval_rule_roles" ("action_type", "role_id")
SELECT a.action_type, r."id"
FROM (VALUES
    ('payment.create', 'FITNESS_MANAGER'), ('payment.create', 'ADMIN'),
    ('cash.create', 'FITNESS_MANAGER'), ('cash.create', 'ADMIN'),
    ('record.delete', 'ADMIN'),
    ('customer.identity', 'FITNESS_MANAGER')
) AS a(action_type, role_code)
JOIN "roles" r ON r."code" = a.role_code;

-- Reasons for rejecting (D-016): only "Khác" to start with.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-000000000005', 'rejectReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);

-- The admin role manages the matrix (09_RBAC.md).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'approval.manage' FROM "roles" WHERE "code" = 'ADMIN';

ALTER TABLE "approval_rules" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT;
