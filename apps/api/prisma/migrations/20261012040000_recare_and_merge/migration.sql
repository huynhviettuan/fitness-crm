-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "merged_at" TIMESTAMPTZ(3),
ADD COLUMN     "merged_into_id" UUID;

-- CreateTable
CREATE TABLE "lead_inquiries" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "channel_option_id" UUID NOT NULL,
    "channel_note" TEXT,
    "source_option_id" UUID,
    "source_note" TEXT,
    "source_type" "SourceType",
    "source_detail" TEXT,
    "need_group_option_id" UUID,
    "need_group_note" TEXT,
    "need_detail" TEXT,
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_merges" (
    "id" UUID NOT NULL,
    "survivor_id" UUID NOT NULL,
    "merged_id" UUID NOT NULL,
    "reason_option_id" UUID NOT NULL,
    "reason_note" TEXT,
    "merged_by" UUID NOT NULL,
    "before" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_inquiries_person_id_created_at_idx" ON "lead_inquiries"("person_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "person_merges_merged_id_key" ON "person_merges"("merged_id");

-- CreateIndex
CREATE INDEX "person_merges_survivor_id_idx" ON "person_merges"("survivor_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_inquiries" ADD CONSTRAINT "lead_inquiries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_inquiries" ADD CONSTRAINT "lead_inquiries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_inquiries" ADD CONSTRAINT "lead_inquiries_channel_option_id_fkey" FOREIGN KEY ("channel_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_inquiries" ADD CONSTRAINT "lead_inquiries_source_option_id_fkey" FOREIGN KEY ("source_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_inquiries" ADD CONSTRAINT "lead_inquiries_need_group_option_id_fkey" FOREIGN KEY ("need_group_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_inquiries" ADD CONSTRAINT "lead_inquiries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_survivor_id_fkey" FOREIGN KEY ("survivor_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_merged_id_fkey" FOREIGN KEY ("merged_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_reason_option_id_fkey" FOREIGN KEY ("reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_merged_by_fkey" FOREIGN KEY ("merged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A merged record (A-064) is always a lead, points at its survivor, and holds no phone, so
-- a phone belongs to one live record (D-019). Its codes stay on the row, never reused (D-038).
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_consistent" CHECK (
    ("merged_into_id" IS NULL) = ("merged_at" IS NULL)
    AND ("merged_into_id" IS NULL OR ("merged_into_id" <> "id" AND "stage" = 'LEAD' AND "phone" IS NULL))
);
ALTER TABLE "person_merges" ADD CONSTRAINT "person_merges_distinct" CHECK ("survivor_id" <> "merged_id");

-- 09_RBAC.md (A-065): Admin and Fitness Manager merge two records of one person.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'lead.merge' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');

-- Checklist version 1, step 10 "Tái chăm sóc" (brief §4.1): "Đặt lịch" books the lead again
-- (status Booked, which starts the pre-visit steps again), "Từ chối" refuses it and sets the
-- next contact-again day (A-062).
UPDATE "consulting_step_templates"
SET "results" = '[{"labelVi":"Đặt lịch","labelEn":"Booked","effect":"BOOK"},{"labelVi":"Từ chối","labelEn":"Refused","effect":"REFUSE"}]'
WHERE "id" = 'd0000000-0000-4000-8000-000000000110';
