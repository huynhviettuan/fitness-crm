-- M10.3: Messenger and Instagram sources (A-275). Like WhatsApp they have no key of their own: Meta signs each delivery with the
-- app secret (kept sealed) and the webhook is set up with a verify token (only its hash kept).
ALTER TABLE "intake_sources" DROP CONSTRAINT "intake_sources_proof_check";
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_proof_check" CHECK (
  ("kind" = 'WEBSITE' AND "key_hash" IS NOT NULL AND "secret_enc" IS NULL)
  OR ("kind" IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM') AND "key_hash" IS NULL AND "secret_enc" IS NOT NULL AND "verify_token_hash" IS NOT NULL)
  OR "kind" NOT IN ('WEBSITE', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM')
);

-- Messenger and Instagram give no phone, only the sender's id for the page or account (PSID, IGSID): it is what ties a person's
-- messages together (A-277).
ALTER TABLE "intake_messages" ADD COLUMN "sender_ref" TEXT;
CREATE INDEX "intake_messages_source_id_sender_ref_idx" ON "intake_messages"("source_id", "sender_ref");
