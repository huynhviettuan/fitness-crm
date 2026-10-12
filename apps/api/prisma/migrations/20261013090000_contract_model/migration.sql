-- M4.3 (D-021, D-022, BR-301, BR-302, A-113 to A-119): the contract model. The price comes from the service's tier;
-- a different price is an exception price; PT and Sale shares; companions; signature; the first payment's due day.

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('NEW', 'RENEW');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('PT', 'SALE');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "activation_deadline" DATE,
ADD COLUMN     "approved_unit_price" DECIMAL(14,0),
ADD COLUMN     "bonus_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bonus_months" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bonus_sessions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contract_date" DATE,
ADD COLUMN     "contract_type" "ContractType" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "exception_note" TEXT,
ADD COLUMN     "exception_reason_option_id" UUID,
ADD COLUMN     "is_exception_price" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_imported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "payment_due_on" DATE,
ADD COLUMN     "previous_contract_id" UUID,
ADD COLUMN     "price_tier_id" UUID,
ADD COLUMN     "promotion_discount" DECIMAL(14,0) NOT NULL DEFAULT 0,
ADD COLUMN     "promotion_id" UUID,
ADD COLUMN     "request_fingerprint" TEXT,
ADD COLUMN     "service_id" UUID,
ADD COLUMN     "signature_note" TEXT,
ADD COLUMN     "signed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signed_by" TEXT,
ADD COLUMN     "signed_on" DATE,
ADD COLUMN     "tier_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tier_months" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tier_unit_price" DECIMAL(14,0),
ADD COLUMN     "vat_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
ADD COLUMN     "vat_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "voucher_discount" DECIMAL(14,0) NOT NULL DEFAULT 0,
ADD COLUMN     "voucher_id" UUID;

-- CreateTable
CREATE TABLE "contract_staff_shares" (
    "contract_id" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "employee_id" UUID NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "contract_staff_shares_pkey" PRIMARY KEY ("contract_id","role","employee_id")
);

-- CreateTable
CREATE TABLE "contract_companions" (
    "contract_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,

    CONSTRAINT "contract_companions_pkey" PRIMARY KEY ("contract_id","customer_id")
);

-- CreateIndex
CREATE INDEX "contract_staff_shares_employee_id_idx" ON "contract_staff_shares"("employee_id");

-- CreateIndex
CREATE INDEX "contract_companions_customer_id_idx" ON "contract_companions"("customer_id");

-- CreateIndex
CREATE INDEX "contracts_service_id_idx" ON "contracts"("service_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_price_tier_id_fkey" FOREIGN KEY ("price_tier_id") REFERENCES "price_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previous_contract_id_fkey" FOREIGN KEY ("previous_contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_exception_reason_option_id_fkey" FOREIGN KEY ("exception_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_staff_shares" ADD CONSTRAINT "contract_staff_shares_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_staff_shares" ADD CONSTRAINT "contract_staff_shares_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_companions" ADD CONSTRAINT "contract_companions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_companions" ADD CONSTRAINT "contract_companions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contracts that exist stay as they are (status unchanged), brought over as imported: no service, and the value is
-- flagged as an exception price because no tier priced it.
UPDATE "contracts"
SET "contract_date" = ("created_at" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    "approved_unit_price" = CASE WHEN "total_sessions" > 0 THEN ROUND("contract_value" / "total_sessions") ELSE "contract_value" END,
    "is_exception_price" = true,
    "is_imported" = true;
ALTER TABLE "contracts" ALTER COLUMN "contract_date" SET NOT NULL;
ALTER TABLE "contracts" ALTER COLUMN "approved_unit_price" SET NOT NULL;

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_bonus_check" CHECK ("bonus_sessions" >= 0 AND "bonus_months" >= 0 AND "bonus_days" >= 0),
  ADD CONSTRAINT "contracts_vat_check" CHECK ("vat_percent" BETWEEN 0 AND 100 AND "vat_amount" >= 0),
  ADD CONSTRAINT "contracts_discount_check" CHECK ("promotion_discount" >= 0 AND "voucher_discount" >= 0),
  -- A priced contract names its service and tier; only an imported one may not (BR-301).
  ADD CONSTRAINT "contracts_service_check" CHECK ("is_imported" OR ("service_id" IS NOT NULL AND "price_tier_id" IS NOT NULL)),
  -- An exception price says why, and a renewal-only link belongs to a renewal.
  ADD CONSTRAINT "contracts_exception_check" CHECK ("is_imported" OR NOT "is_exception_price" OR "exception_reason_option_id" IS NOT NULL),
  ADD CONSTRAINT "contracts_previous_check" CHECK ("previous_contract_id" IS NULL OR "contract_type" = 'RENEW');

ALTER TABLE "contract_staff_shares"
  ADD CONSTRAINT "contract_staff_shares_percent_check" CHECK ("percent" > 0 AND "percent" <= 100);

-- Why a contract has an exception price (D-016): only "Khác" until the owner names the reasons.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-000000000021', 'exceptionPriceReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);
