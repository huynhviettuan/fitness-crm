-- CreateEnum
CREATE TYPE "ConsultingAuditResult" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "consulting_audits" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "result" "ConsultingAuditResult" NOT NULL,
    "comment" TEXT,
    "auditor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consulting_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consulting_audit_criteria" (
    "audit_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "consulting_audit_criteria_pkey" PRIMARY KEY ("audit_id","option_id")
);

-- CreateIndex
CREATE INDEX "consulting_audits_person_id_created_at_idx" ON "consulting_audits"("person_id", "created_at");

-- AddForeignKey
ALTER TABLE "consulting_audits" ADD CONSTRAINT "consulting_audits_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_audits" ADD CONSTRAINT "consulting_audits_auditor_id_fkey" FOREIGN KEY ("auditor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_audit_criteria" ADD CONSTRAINT "consulting_audit_criteria_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "consulting_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_audit_criteria" ADD CONSTRAINT "consulting_audit_criteria_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A-087: the criteria a Fail can name are an admin list (D-016); only "Khác" until the owner gives them.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-00000000000f', 'auditFailReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);
