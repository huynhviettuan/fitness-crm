-- M4.0 (P-6, D-036, D-059): the email outbox. The service writes a row in the transaction of the change that
-- causes the email; the worker sends it. The rows are also the customer's "Emails sent" tab (FR-MAIL-003).

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "to_address" TEXT,
    "locale" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failure" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "failure_task_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_messages_locale_check" CHECK ("locale" IN ('vi', 'en')),
    CONSTRAINT "email_messages_attempts_check" CHECK ("attempts" >= 0),
    -- A sent email says when; a failed one says why.
    CONSTRAINT "email_messages_sent_check" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
    CONSTRAINT "email_messages_failed_check" CHECK ("status" <> 'FAILED' OR "failure" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_dedupe_key_key" ON "email_messages"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_failure_task_id_key" ON "email_messages"("failure_task_id");

-- CreateIndex
CREATE INDEX "email_messages_person_id_created_at_idx" ON "email_messages"("person_id", "created_at");

-- CreateIndex
CREATE INDEX "email_messages_status_next_attempt_at_idx" ON "email_messages"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_failure_task_id_fkey" FOREIGN KEY ("failure_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
