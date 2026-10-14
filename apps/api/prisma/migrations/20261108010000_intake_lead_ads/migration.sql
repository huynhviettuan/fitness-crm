-- M10.4: Lead Ads forms arrive on the Facebook Page's webhook (the Messenger source) with only a lead id; their answers are read from
-- Meta with the Page's access token, kept sealed like the app secret (A-283).
ALTER TABLE "intake_sources" ADD COLUMN "page_token_enc" TEXT;
ALTER TABLE "intake_sources" ADD CONSTRAINT "intake_sources_page_token_check" CHECK ("page_token_enc" IS NULL OR "kind" = 'MESSENGER');
