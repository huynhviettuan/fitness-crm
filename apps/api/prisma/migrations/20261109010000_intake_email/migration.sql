-- M10.5: email sources (A-287). An email source proves itself with a key of its own like the website form (sent as the Basic
-- password of the webhook address), and keeps the last notice the forwarding sent for Admin (Gmail's confirmation of the rule).
ALTER TABLE "intake_sources" DROP CONSTRAINT "intake_sources_proof_check";
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_proof_check" CHECK (
  ("kind" IN ('WEBSITE', 'EMAIL') AND "key_hash" IS NOT NULL AND "secret_enc" IS NULL)
  OR ("kind" IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM') AND "key_hash" IS NULL AND "secret_enc" IS NOT NULL AND "verify_token_hash" IS NOT NULL)
  OR "kind" NOT IN ('WEBSITE', 'EMAIL', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM')
);
ALTER TABLE "intake_sources" ADD COLUMN "last_notice" TEXT;
ALTER TABLE "intake_sources" ADD COLUMN "last_notice_at" TIMESTAMPTZ(3);
