-- M10.6: Zalo OA sources, receive only (A-294). A Zalo source has no key and no verify token: each event is signed with
-- sha256(appId + body + timestamp + OA secret key), so it keeps the Zalo app id and the OA secret key (sealed).
ALTER TABLE "intake_sources" ADD COLUMN "app_ref" TEXT;

ALTER TABLE "intake_sources" DROP CONSTRAINT "intake_sources_proof_check";
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_proof_check" CHECK (
  ("kind" IN ('WEBSITE', 'EMAIL') AND "key_hash" IS NOT NULL AND "secret_enc" IS NULL)
  OR ("kind" IN ('WHATSAPP', 'MESSENGER', 'INSTAGRAM') AND "key_hash" IS NULL AND "secret_enc" IS NOT NULL AND "verify_token_hash" IS NOT NULL)
  OR ("kind" = 'ZALO' AND "key_hash" IS NULL AND "secret_enc" IS NOT NULL AND "app_ref" IS NOT NULL)
  OR "kind" NOT IN ('WEBSITE', 'EMAIL', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'ZALO')
);
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_app_ref_check" CHECK ("app_ref" IS NULL OR "kind" = 'ZALO');
