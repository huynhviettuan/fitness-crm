-- M10.2: WhatsApp sources (A-268). A source of this kind has no key of its own: Meta proves itself by signing each webhook with
-- the app secret (kept sealed), and the one-time handshake is answered with a token of which only the hash is kept.
ALTER TABLE "intake_sources" ALTER COLUMN "key_hash" DROP NOT NULL;
ALTER TABLE "intake_sources" ADD COLUMN "secret_enc" TEXT;
ALTER TABLE "intake_sources" ADD COLUMN "verify_token_hash" TEXT;

ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_proof_check" CHECK (
  ("kind" = 'WEBSITE' AND "key_hash" IS NOT NULL AND "secret_enc" IS NULL)
  OR ("kind" = 'WHATSAPP' AND "key_hash" IS NULL AND "secret_enc" IS NOT NULL AND "verify_token_hash" IS NOT NULL)
  OR "kind" NOT IN ('WEBSITE', 'WHATSAPP')
);
