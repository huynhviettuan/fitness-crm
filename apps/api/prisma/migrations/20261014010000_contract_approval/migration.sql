-- M4.4a (D-018, D-022, brief §5.2 to §5.4, A-120 to A-125): contracts go through the approval engine, an approved
-- contract is locked by the database, and an approver can turn one down. Deleting and unapproving are Admin's.

-- AlterEnum (the new value is not used in this migration)
ALTER TYPE "ContractStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "delete_reason_note" TEXT,
ADD COLUMN     "delete_reason_option_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "deleted_by" UUID;

-- CreateIndex
CREATE INDEX "contracts_deleted_at_idx" ON "contracts"("deleted_at");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_delete_reason_option_id_fkey" FOREIGN KEY ("delete_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A deletion is complete: who, when, and why (D-035).
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deletion_complete" CHECK (
    ("deleted_at" IS NULL) = ("deleted_by" IS NULL) AND ("deleted_at" IS NULL) = ("delete_reason_option_id" IS NULL)
);

-- Contracts that were already active were approved by whoever created them in the old flow; the approval is not known.

-- The lock after approval (D-022, brief §5.4): what the contract sold and for how much cannot change once it left
-- "pending approval", for any role and any code path. The status, the notes, the signature, and the end date (which
-- freezes and change vouchers move later) stay open. Unapproving (ACTIVE to DRAFT) changes none of the locked columns.
CREATE FUNCTION contracts_lock() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('ACTIVE', 'CANCELLED') AND (
        NEW.customer_id, NEW.branch_id, NEW.service_id, NEW.price_tier_id, NEW.contract_type, NEW.previous_contract_id,
        NEW.contract_date, NEW.contract_value, NEW.total_sessions, NEW.bonus_sessions, NEW.bonus_months, NEW.bonus_days,
        NEW.tier_months, NEW.tier_days, NEW.start_date, NEW.activation_deadline, NEW.tier_unit_price,
        NEW.approved_unit_price, NEW.is_exception_price, NEW.exception_reason_option_id, NEW.exception_note,
        NEW.promotion_id, NEW.voucher_id, NEW.promotion_discount, NEW.voucher_discount, NEW.vat_percent,
        NEW.vat_amount, NEW.package_name, NEW.contract_code, NEW.opening_sessions_used, NEW.opening_paid_amount
    ) IS DISTINCT FROM (
        OLD.customer_id, OLD.branch_id, OLD.service_id, OLD.price_tier_id, OLD.contract_type, OLD.previous_contract_id,
        OLD.contract_date, OLD.contract_value, OLD.total_sessions, OLD.bonus_sessions, OLD.bonus_months, OLD.bonus_days,
        OLD.tier_months, OLD.tier_days, OLD.start_date, OLD.activation_deadline, OLD.tier_unit_price,
        OLD.approved_unit_price, OLD.is_exception_price, OLD.exception_reason_option_id, OLD.exception_note,
        OLD.promotion_id, OLD.voucher_id, OLD.promotion_discount, OLD.voucher_discount, OLD.vat_percent,
        OLD.vat_amount, OLD.package_name, OLD.contract_code, OLD.opening_sessions_used, OLD.opening_paid_amount
    ) THEN
        RAISE EXCEPTION 'contract % is locked after approval', OLD.contract_code USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_lock" BEFORE UPDATE ON "contracts"
    FOR EACH ROW EXECUTE FUNCTION contracts_lock();

-- The PT and Sale shares and the companions belong to what was sold: they change only while the contract is pending
-- or rejected. When the contract itself is being deleted (cascade) it is already gone and the check passes.
CREATE FUNCTION contract_parts_lock() RETURNS trigger AS $$
DECLARE
    parent_status "ContractStatus";
BEGIN
    SELECT status INTO parent_status FROM contracts WHERE id = COALESCE(NEW.contract_id, OLD.contract_id);
    IF parent_status IS NOT NULL AND parent_status NOT IN ('DRAFT', 'REJECTED') THEN
        RAISE EXCEPTION 'contract is locked after approval' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_staff_shares_lock" BEFORE INSERT OR UPDATE OR DELETE ON "contract_staff_shares"
    FOR EACH ROW EXECUTE FUNCTION contract_parts_lock();
CREATE TRIGGER "contract_companions_lock" BEFORE INSERT OR UPDATE OR DELETE ON "contract_companions"
    FOR EACH ROW EXECUTE FUNCTION contract_parts_lock();

-- The matrix (09_RBAC.md): a new contract waits for a Fitness Manager or Admin.
INSERT INTO "approval_rules" ("id", "action_type", "required", "overdue_hours", "updated_at")
VALUES (gen_random_uuid(), 'contract.create', true, 24, CURRENT_TIMESTAMP);
INSERT INTO "approval_rule_roles" ("action_type", "role_id")
SELECT 'contract.create', "id" FROM "roles" WHERE "code" IN ('FITNESS_MANAGER', 'ADMIN');

-- Contracts already waiting get their request, in their creator's name, so they show in the approvers' inbox.
INSERT INTO "approval_requests" ("id", "action_type", "entity_type", "entity_id", "branch_id", "title", "amount",
                                 "submitted_by", "submitted_at")
SELECT gen_random_uuid(), 'contract.create', 'contract', c."id", c."branch_id", c."contract_code" || ' · ' || p."full_name",
       c."contract_value", c."created_by", c."created_at"
FROM "contracts" c
JOIN "customers" p ON p."id" = c."customer_id"
WHERE c."status" = 'DRAFT';

-- Unapproving and deleting a contract: Admin only (09_RBAC.md).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", perm FROM "roles", (VALUES ('contract.unapprove'), ('contract.delete')) AS p(perm) WHERE "code" = 'ADMIN';

-- Why an approved contract was sent back (D-016): only "Khác" to start with.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-000000000022', 'unapproveReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);
