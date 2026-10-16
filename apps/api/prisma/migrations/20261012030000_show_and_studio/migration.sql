-- CreateEnum
CREATE TYPE "StepAction" AS ENUM ('STUDIO_TASK');

-- CreateEnum
CREATE TYPE "IdDocumentType" AS ENUM ('CCCD', 'PASSPORT');

-- AlterTable
ALTER TABLE "consulting_step_templates" ADD COLUMN     "action" "StepAction";

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "data_consent_at" TIMESTAMPTZ(3),
ADD COLUMN     "data_consent_by" UUID,
ADD COLUMN     "health_note" TEXT,
ADD COLUMN     "id_document_number" TEXT,
ADD COLUMN     "id_document_type" "IdDocumentType",
ADD COLUMN     "nationality" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "source" TEXT;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_data_consent_by_fkey" FOREIGN KEY ("data_consent_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- D-042: ID numbers and health notes are stored only encrypted (field-crypto.ts, "v1:..."),
-- so a write that forgot to encrypt is refused; an ID document comes with its type and
-- the customer's recorded consent.
ALTER TABLE "customers" ADD CONSTRAINT "customers_sensitive_encrypted" CHECK (
    ("id_document_number" IS NULL OR "id_document_number" LIKE 'v1:%')
    AND ("health_note" IS NULL OR "health_note" LIKE 'v1:%')
);
ALTER TABLE "customers" ADD CONSTRAINT "customers_id_document_consent" CHECK (
    ("id_document_number" IS NULL) = ("id_document_type" IS NULL)
    AND ("id_document_number" IS NULL OR "data_consent_at" IS NOT NULL)
);

-- Checklist version 1 (brief §4.1): Báo Studio is sent by the system right after each
-- pre-visit reminder, through Giao việc (A-059); recording Show or No show on step 9 does
-- what the lead's Show and No show buttons do.
UPDATE "consulting_step_templates" SET "auto_complete" = true, "action" = 'STUDIO_TASK'
WHERE "id" IN ('d0000000-0000-4000-8000-000000000106', 'd0000000-0000-4000-8000-000000000108');
UPDATE "consulting_step_templates"
SET "results" = '[{"labelVi":"Show","labelEn":"Show","effect":"SHOW"},{"labelVi":"No show","labelEn":"No show","effect":"NO_SHOW"}]'
WHERE "id" = 'd0000000-0000-4000-8000-000000000109';

-- D-042: who may see ID documents and health notes (A-060). ID documents are hidden from
-- Master, PT, Marketing, and Kế toán; health notes from Marketing and Kế toán (a PT needs
-- them to train the customer safely).
INSERT INTO "role_field_masks" ("role_id", "field")
SELECT "id", 'customer.idDocument' FROM "roles" WHERE "code" IN ('MASTER', 'PT', 'MARKETING', 'ACCOUNTANT');
INSERT INTO "role_field_masks" ("role_id", "field")
SELECT "id", 'customer.health' FROM "roles" WHERE "code" IN ('MARKETING', 'ACCOUNTANT');
