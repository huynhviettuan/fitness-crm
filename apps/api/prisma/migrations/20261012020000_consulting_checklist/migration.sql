-- CreateEnum
CREATE TYPE "StepTrigger" AS ENUM ('ASSIGNED', 'STATUS', 'APPOINTMENT', 'AFTER_STEP', 'RECARE');

-- CreateEnum
CREATE TYPE "StepTiming" AS ENUM ('ON_TIME', 'LATE');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "checklist_id" UUID;

-- CreateTable
CREATE TABLE "consulting_checklists" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consulting_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consulting_step_templates" (
    "id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label_vi" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "trigger" "StepTrigger" NOT NULL,
    "trigger_status" "LeadStatus",
    "trigger_step_key" TEXT,
    "offset_minutes" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL,
    "auto_complete" BOOLEAN NOT NULL DEFAULT false,
    "results" JSONB NOT NULL,

    CONSTRAINT "consulting_step_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_steps" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "due_notified_at" TIMESTAMPTZ(3),
    "done_at" TIMESTAMPTZ(3),
    "done_by" UUID,
    "result_index" INTEGER,
    "note" TEXT,
    "timing" "StepTiming",

    CONSTRAINT "lead_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consulting_checklists_version_key" ON "consulting_checklists"("version");

-- CreateIndex
CREATE UNIQUE INDEX "consulting_step_templates_checklist_id_key_key" ON "consulting_step_templates"("checklist_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "consulting_step_templates_checklist_id_sort_order_key" ON "consulting_step_templates"("checklist_id", "sort_order");

-- CreateIndex
CREATE INDEX "lead_steps_due_at_idx" ON "lead_steps"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_steps_customer_id_template_id_key" ON "lead_steps"("customer_id", "template_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "consulting_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_step_templates" ADD CONSTRAINT "consulting_step_templates_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "consulting_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_steps" ADD CONSTRAINT "lead_steps_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_steps" ADD CONSTRAINT "lead_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "consulting_step_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_steps" ADD CONSTRAINT "lead_steps_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Version 1 of the consulting checklist: the brief's ten steps (brief §4.1, docs/02 flow 3),
-- fixed ids so tests can find them. All required, which admin changes per step (A-056).
-- Step 1 is due 60 minutes after assignment (A-055); "Đặt lịch" is done by booking the
-- visit (A-057); re-care follows the lead's contact-again day (parameter recareDays).
INSERT INTO "consulting_checklists" ("id", "version", "created_at") VALUES ('d0000000-0000-4000-8000-000000000001', 1, CURRENT_TIMESTAMP);
INSERT INTO "consulting_step_templates" ("id", "checklist_id", "sort_order", "key", "label_vi", "label_en", "trigger", "trigger_status", "trigger_step_key", "offset_minutes", "required", "results") VALUES
    ('d0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-000000000001', 1, 'tu-van', 'Tư vấn sản phẩm phù hợp', 'Recommend the right product', 'ASSIGNED', NULL, NULL, 60, true, '[{"labelVi":"Done","labelEn":"Done"}]'),
    ('d0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-000000000001', 2, 'nhac-1', 'Nhắc lần 1', 'Reminder 1', 'STATUS', 'NO_RESPONSE', NULL, 60, true, '[{"labelVi":"Đã nhắc","labelEn":"Reminded"}]'),
    ('d0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-000000000001', 3, 'nhac-2', 'Nhắc lần 2', 'Reminder 2', 'STATUS', 'NO_RESPONSE', NULL, 1440, true, '[{"labelVi":"Đã nhắc","labelEn":"Reminded"}]'),
    ('d0000000-0000-4000-8000-000000000104', 'd0000000-0000-4000-8000-000000000001', 4, 'dat-lich', 'Đặt lịch', 'Book the visit', 'STATUS', 'BOOKED', NULL, 0, true, '[{"labelVi":"Done","labelEn":"Done"}]'),
    ('d0000000-0000-4000-8000-000000000105', 'd0000000-0000-4000-8000-000000000001', 5, 'nhac-truoc-hen-1', 'Nhắc trước hẹn lần 1', 'Pre-visit reminder 1', 'APPOINTMENT', NULL, NULL, -180, true, '[{"labelVi":"Khách xác nhận","labelEn":"Confirmed"},{"labelVi":"Không phản hồi","labelEn":"No reply"}]'),
    ('d0000000-0000-4000-8000-000000000106', 'd0000000-0000-4000-8000-000000000001', 6, 'bao-studio-1', 'Báo Studio lần 1', 'Notify Studio 1', 'AFTER_STEP', NULL, 'nhac-truoc-hen-1', 0, true, '[{"labelVi":"Done","labelEn":"Done"}]'),
    ('d0000000-0000-4000-8000-000000000107', 'd0000000-0000-4000-8000-000000000001', 7, 'nhac-truoc-hen-2', 'Nhắc trước hẹn lần 2', 'Pre-visit reminder 2', 'APPOINTMENT', NULL, NULL, -60, true, '[{"labelVi":"Khách xác nhận","labelEn":"Confirmed"},{"labelVi":"Không phản hồi","labelEn":"No reply"}]'),
    ('d0000000-0000-4000-8000-000000000108', 'd0000000-0000-4000-8000-000000000001', 8, 'bao-studio-2', 'Báo Studio lần 2', 'Notify Studio 2', 'AFTER_STEP', NULL, 'nhac-truoc-hen-2', 0, true, '[{"labelVi":"Done","labelEn":"Done"}]'),
    ('d0000000-0000-4000-8000-000000000109', 'd0000000-0000-4000-8000-000000000001', 9, 'show', 'Ghi nhận Show / No show', 'Record Show / No show', 'APPOINTMENT', NULL, NULL, 0, true, '[{"labelVi":"Show","labelEn":"Show"},{"labelVi":"No show","labelEn":"No show"}]'),
    ('d0000000-0000-4000-8000-000000000110', 'd0000000-0000-4000-8000-000000000001', 10, 'tai-cham-soc', 'Tái chăm sóc', 'Re-care', 'RECARE', NULL, NULL, 0, true, '[{"labelVi":"Đặt lịch","labelEn":"Booked"},{"labelVi":"Từ chối","labelEn":"Refused"}]');

UPDATE "consulting_step_templates" SET "auto_complete" = true WHERE "id" = 'd0000000-0000-4000-8000-000000000104';

-- Existing leads get version 1, every step waiting.
UPDATE "customers" SET "checklist_id" = 'd0000000-0000-4000-8000-000000000001' WHERE "stage" = 'LEAD';
INSERT INTO "lead_steps" ("id", "customer_id", "template_id")
SELECT gen_random_uuid(), c."id", t."id" FROM "customers" c CROSS JOIN "consulting_step_templates" t
WHERE c."stage" = 'LEAD' AND t."checklist_id" = 'd0000000-0000-4000-8000-000000000001';
