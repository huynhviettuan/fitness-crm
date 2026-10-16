-- M4.2 (D-021, BR-303, A-110, A-112): promotions and vouchers, and the discount a role may approve.

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('PROMOTION', 'VOUCHER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "discount_threshold_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "discount_type" "DiscountType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_services" (
    "promotion_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "promotion_services_pkey" PRIMARY KEY ("promotion_id","service_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_kind_active_idx" ON "promotions"("kind", "active");

-- CreateIndex
CREATE INDEX "promotion_services_service_id_idx" ON "promotion_services"("service_id");

-- AddForeignKey
ALTER TABLE "promotion_services" ADD CONSTRAINT "promotion_services_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_services" ADD CONSTRAINT "promotion_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A voucher has a code and a promotion has none; a percent is 0 to 100; dates are in order.
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_code_check" CHECK (("kind" = 'VOUCHER') = ("code" IS NOT NULL)),
  ADD CONSTRAINT "promotions_value_check" CHECK ("value" > 0 AND ("discount_type" <> 'PERCENT' OR "value" <= 100)),
  ADD CONSTRAINT "promotions_dates_check" CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_to" >= "valid_from");

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_discount_threshold_check" CHECK ("discount_threshold_pct" BETWEEN 0 AND 100);

-- Initial limits (A-112, OQ-038): Admin approves any discount, the Fitness Manager up to 10%, the others none.
UPDATE "roles" SET "discount_threshold_pct" = 100 WHERE "code" = 'ADMIN';
UPDATE "roles" SET "discount_threshold_pct" = 10 WHERE "code" = 'FITNESS_MANAGER';

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'promotion.manage' FROM "roles" WHERE "code" = 'ADMIN';
