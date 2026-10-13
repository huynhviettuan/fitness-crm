-- M4.6 (D-023, brief §5.5, AC-14): deactivating (Tạm vô hiệu) and reactivating a contract. Each deactivation is its own
-- record and extends the end date at most once, when it ends.

-- AlterEnum (the new value is not used in this migration)
ALTER TYPE "ContractStatus" ADD VALUE 'FROZEN';

-- CreateTable
CREATE TABLE "contract_freezes" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "frozen_on" DATE NOT NULL,
    "frozen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozen_by" UUID NOT NULL,
    "reason_option_id" UUID NOT NULL,
    "reason_note" TEXT,
    "ended_at" TIMESTAMPTZ(3),
    "ended_on" DATE,
    "ended_by" UUID,
    "end_reason_option_id" UUID,
    "end_reason_note" TEXT,
    "frozen_days" INTEGER,
    "added_days" INTEGER,
    "previous_end_date" DATE,
    "new_end_date" DATE,
    "reminded_at" TIMESTAMPTZ(3),

    CONSTRAINT "contract_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_freezes_contract_id_idx" ON "contract_freezes"("contract_id");
-- A contract is frozen once at a time, also under concurrent requests.
CREATE UNIQUE INDEX "contract_freezes_one_open" ON "contract_freezes"("contract_id") WHERE "ended_at" IS NULL;

-- AddForeignKey
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_frozen_by_fkey" FOREIGN KEY ("frozen_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_reason_option_id_fkey" FOREIGN KEY ("reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_end_reason_option_id_fkey" FOREIGN KEY ("end_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A freeze that has not ended has none of the end fields; one that has, has the day, who, and the days (D-023).
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_end_complete" CHECK (
    ("ended_at" IS NULL) = ("ended_on" IS NULL) AND ("ended_at" IS NULL) = ("ended_by" IS NULL)
    AND ("ended_at" IS NULL) = ("frozen_days" IS NULL) AND ("ended_at" IS NULL) = ("added_days" IS NULL)
);
ALTER TABLE "contract_freezes" ADD CONSTRAINT "contract_freezes_days_range" CHECK (
    ("frozen_days" IS NULL OR "frozen_days" >= 0) AND ("added_days" IS NULL OR "added_days" >= 0)
);

-- The lock after approval also holds for a frozen contract (D-022): only the end date moves, and only on reactivation.
CREATE OR REPLACE FUNCTION contracts_lock() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('ACTIVE', 'CANCELLED', 'FROZEN') AND (
        NEW.customer_id, NEW.branch_id, NEW.service_id, NEW.price_tier_id, NEW.contract_type, NEW.previous_contract_id,
        NEW.contract_date, NEW.contract_value, NEW.total_sessions, NEW.bonus_sessions, NEW.bonus_months, NEW.bonus_days,
        NEW.tier_months, NEW.tier_days, NEW.start_date, NEW.activation_deadline, NEW.tier_unit_price,
        NEW.approved_unit_price, NEW.is_exception_price, NEW.exception_reason_option_id, NEW.exception_note,
        NEW.promotion_id, NEW.voucher_id, NEW.promotion_discount, NEW.voucher_discount, NEW.vat_percent,
        NEW.vat_amount, NEW.package_name, NEW.contract_code
    ) IS DISTINCT FROM (
        OLD.customer_id, OLD.branch_id, OLD.service_id, OLD.price_tier_id, OLD.contract_type, OLD.previous_contract_id,
        OLD.contract_date, OLD.contract_value, OLD.total_sessions, OLD.bonus_sessions, OLD.bonus_months, OLD.bonus_days,
        OLD.tier_months, OLD.tier_days, OLD.start_date, OLD.activation_deadline, OLD.tier_unit_price,
        OLD.approved_unit_price, OLD.is_exception_price, OLD.exception_reason_option_id, OLD.exception_note,
        OLD.promotion_id, OLD.voucher_id, OLD.promotion_discount, OLD.voucher_discount, OLD.vat_percent,
        OLD.vat_amount, OLD.package_name, OLD.contract_code
    ) THEN
        RAISE EXCEPTION 'contract % is locked after approval', OLD.contract_code USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reasons for deactivating and reactivating (D-016): only "Khác" to start with.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at") VALUES
    ('c0000000-0000-4000-8000-000000000023', 'freezeReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000024', 'unfreezeReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);

-- Deactivating and reactivating are Admin's (09_RBAC.md, brief §2).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", perm FROM "roles", (VALUES ('contract.deactivate'), ('contract.reactivate')) AS p(perm) WHERE "code" = 'ADMIN';
