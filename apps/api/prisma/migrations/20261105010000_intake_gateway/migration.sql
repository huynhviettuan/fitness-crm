-- M10.1 (brief §11, D-044, TS-007; A-261 to A-267): the lead intake gateway. A source is one connection that hands leads to the
-- system (the website form now; WhatsApp, Messenger, Instagram, Gmail, Zalo and TikTok in their own slices) with its own secret
-- key, of which only the hash is stored. Every submission is kept as a message on the person it became, once: the source's own id
-- for the submission is unique, so sending it twice makes one lead.
CREATE TYPE "IntakeKind" AS ENUM ('WEBSITE', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'EMAIL', 'ZALO', 'TIKTOK');
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "intake_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "kind" "IntakeKind" NOT NULL,
    "branch_id" UUID NOT NULL,
    "channel_option_id" UUID NOT NULL,
    "source_option_id" UUID,
    "key_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_received_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_sources_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "intake_sources_key_hash_key" ON "intake_sources"("key_hash");
CREATE INDEX "intake_sources_branch_id_idx" ON "intake_sources"("branch_id");
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_channel_option_id_fkey" FOREIGN KEY ("channel_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_source_option_id_fkey" FOREIGN KEY ("source_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "intake_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    -- Empty only while the submission is being turned into a person; set when it is done.
    "person_id" UUID,
    "direction" "MessageDirection" NOT NULL DEFAULT 'IN',
    "sender_name" TEXT,
    "body" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intake_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "intake_messages_source_id_external_id_key" ON "intake_messages"("source_id", "external_id");
CREATE INDEX "intake_messages_person_id_received_at_idx" ON "intake_messages"("person_id", "received_at");
ALTER TABLE "intake_messages" ADD CONSTRAINT "intake_messages_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "intake_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intake_messages" ADD CONSTRAINT "intake_messages_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The sources are Admin's.
INSERT INTO "role_permissions" ("role_id", "permission") SELECT "id", 'intake.manage' FROM "roles" WHERE "code" = 'ADMIN';
