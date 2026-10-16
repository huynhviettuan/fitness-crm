-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "appointment_at" TIMESTAMPTZ(3),
ADD COLUMN     "contact_again_on" DATE,
ADD COLUMN     "lead_status_changed_at" TIMESTAMPTZ(3),
ADD COLUMN     "refuse_reason_note" TEXT,
ADD COLUMN     "refuse_reason_option_id" UUID;

-- CreateTable
CREATE TABLE "lead_status_changes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "from_status" "LeadStatus",
    "to_status" "LeadStatus" NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointment_at" TIMESTAMPTZ(3),
    "reason_option_id" UUID,
    "reason_note" TEXT,
    "note" TEXT,

    CONSTRAINT "lead_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_assignments" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID NOT NULL,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_round_robin" (
    "branch_id" UUID NOT NULL,
    "last_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_round_robin_pkey" PRIMARY KEY ("branch_id")
);

-- CreateIndex
CREATE INDEX "lead_status_changes_customer_id_changed_at_idx" ON "lead_status_changes"("customer_id", "changed_at");

-- CreateIndex
CREATE INDEX "lead_assignments_customer_id_assigned_at_idx" ON "lead_assignments"("customer_id", "assigned_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_refuse_reason_option_id_fkey" FOREIGN KEY ("refuse_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_reason_option_id_fkey" FOREIGN KEY ("reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_round_robin" ADD CONSTRAINT "lead_round_robin_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_round_robin" ADD CONSTRAINT "lead_round_robin_last_user_id_fkey" FOREIGN KEY ("last_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Leads keep the time they entered their status (D-020); existing ones since creation.
UPDATE "customers" SET "lead_status_changed_at" = "created_at" WHERE "stage" = 'LEAD';

-- A lead has its lead code, status, and the time it entered it; a customer its customer
-- code and a phone (D-019).
ALTER TABLE "customers" DROP CONSTRAINT "customers_stage_codes";
ALTER TABLE "customers" ADD CONSTRAINT "customers_stage_codes" CHECK (
    ("stage" = 'LEAD' AND "lead_code" IS NOT NULL AND "lead_status" IS NOT NULL AND "lead_status_changed_at" IS NOT NULL)
    OR ("stage" = 'CUSTOMER' AND "customer_code" IS NOT NULL AND "phone" IS NOT NULL)
);

-- The timeline starts with each existing lead's creation.
INSERT INTO "lead_status_changes" ("id", "customer_id", "from_status", "to_status", "changed_by", "changed_at")
SELECT gen_random_uuid(), "id", NULL, "lead_status", "created_by", "created_at" FROM "customers" WHERE "stage" = 'LEAD';

-- Refusal reasons (BR-204) start with only "Khác" (A-034); admin adds the rest (A-053).
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "active", "is_other", "updated_at") VALUES
    ('c0000000-0000-4000-8000-00000000000d', 'leadRefuseReasons', 'Khác', 'Other', 0, true, true, CURRENT_TIMESTAMP);

-- 09_RBAC.md: Admin and Fitness Manager reassign leads and hear of new ones; Consulting
-- receives new leads round-robin (BR-203, A-052).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'lead.assign' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'lead.receive' FROM "roles" WHERE "code" = 'CONSULTING';
