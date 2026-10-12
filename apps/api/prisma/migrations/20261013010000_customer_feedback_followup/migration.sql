-- M2.7 (the owner's answers of 12/10/2026). Step 1: the nationality is a country (D-057).
ALTER TABLE "customers" ADD COLUMN "country_code" CHAR(2);

-- Vietnamese people have their country; those recorded only as "foreign" keep it empty and are
-- flagged for completion in the screens.
UPDATE "customers" SET "country_code" = 'VN' WHERE "nationality_group" = 'VIETNAM';
UPDATE "customers" SET "country_code" = 'VN'
  WHERE "country_code" IS NULL AND lower(btrim("nationality")) IN ('việt nam', 'viet nam', 'vietnam', 'vn');
UPDATE "customers" SET "nationality_group" = 'VIETNAM'
  WHERE "country_code" = 'VN' AND "nationality_group" IS NULL;

ALTER TABLE "customers" ADD CONSTRAINT "customers_country_code_format" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$');
