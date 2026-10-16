-- M8.1 (brief §5.6, FR-CHG-001, FR-CHG-002, D-024; A-219 to A-226): the change vouchers of a contract. One table, one row for
-- each voucher of any kind, linked to the contract it acts on. A voucher waits for approval (the matrix has a row for each
-- kind, all needing the Fitness Manager or Admin, OQ-023) and has its effect only when approved; the effect is set once at
-- approval and summed into the contract by a trigger, so the sessions and the value of a contract are derived from its
-- vouchers and never typed (T-050).
CREATE SEQUENCE voucher_seq;

CREATE TYPE "VoucherKind" AS ENUM ('RENEWAL', 'UPGRADE', 'HOLD', 'TRANSFER', 'BRANCH_TRANSFER', 'CONVERSION', 'CANCELLATION');
CREATE TYPE "VoucherStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "contract_change_vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "voucher_number" TEXT NOT NULL,
    "kind" "VoucherKind" NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'PENDING',
    "contract_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "from_date" DATE,
    "to_date" DATE,
    "months" INTEGER,
    "days" INTEGER,
    "sessions" INTEGER,
    "amount" DECIMAL(14,0),
    "note" TEXT,
    "sessions_delta" INTEGER NOT NULL DEFAULT 0,
    "value_delta" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "end_date_before" DATE,
    "end_date_after" DATE,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_change_vouchers_pkey" PRIMARY KEY ("id"),
    -- Only an approved voucher has an effect.
    CONSTRAINT "contract_change_vouchers_effect_check" CHECK (
        "status" = 'APPROVED' OR ("sessions_delta" = 0 AND "value_delta" = 0)
    ),
    CONSTRAINT "contract_change_vouchers_approved_check" CHECK (
        ("status" = 'PENDING') = ("approved_by" IS NULL AND "approved_at" IS NULL)
    ),
    CONSTRAINT "contract_change_vouchers_fields_check" CHECK (
        ("months" IS NULL OR "months" >= 0) AND ("days" IS NULL OR "days" >= 0) AND ("sessions" IS NULL OR "sessions" >= 0)
        AND ("amount" IS NULL OR "amount" >= 0)
        AND ("from_date" IS NULL OR "to_date" IS NULL OR "to_date" >= "from_date")
    ),
    -- A hold has its two days; a renewal adds something.
    CONSTRAINT "contract_change_vouchers_kind_check" CHECK (
        ("kind" <> 'HOLD' OR ("from_date" IS NOT NULL AND "to_date" IS NOT NULL))
        AND ("kind" <> 'RENEWAL' OR (COALESCE("months", 0) + COALESCE("days", 0) + COALESCE("sessions", 0)) > 0)
    )
);

CREATE UNIQUE INDEX "contract_change_vouchers_voucher_number_key" ON "contract_change_vouchers"("voucher_number");
CREATE UNIQUE INDEX "contract_change_vouchers_idempotency_key_key" ON "contract_change_vouchers"("idempotency_key");
CREATE INDEX "contract_change_vouchers_contract_id_status_idx" ON "contract_change_vouchers"("contract_id", "status");
CREATE INDEX "contract_change_vouchers_customer_id_idx" ON "contract_change_vouchers"("customer_id");
CREATE INDEX "contract_change_vouchers_branch_id_idx" ON "contract_change_vouchers"("branch_id");

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What the approved vouchers added to a contract: derived by the database, never written by the application.
ALTER TABLE "contracts" ADD COLUMN "voucher_sessions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "contracts" ADD COLUMN "voucher_value" DECIMAL(14,0) NOT NULL DEFAULT 0;

CREATE FUNCTION contract_voucher_totals() RETURNS trigger AS $$
DECLARE
    target UUID;
BEGIN
    FOR target IN SELECT DISTINCT id FROM (VALUES (NEW.contract_id), (OLD.contract_id)) AS ids(id) WHERE id IS NOT NULL LOOP
        UPDATE contracts SET
            voucher_sessions = COALESCE((SELECT SUM(sessions_delta) FROM contract_change_vouchers
                                         WHERE contract_id = target AND status = 'APPROVED'), 0),
            voucher_value = COALESCE((SELECT SUM(value_delta) FROM contract_change_vouchers
                                      WHERE contract_id = target AND status = 'APPROVED'), 0)
        WHERE id = target;
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_change_vouchers_totals"
    AFTER INSERT OR UPDATE OR DELETE ON "contract_change_vouchers"
    FOR EACH ROW EXECUTE FUNCTION contract_voucher_totals();

-- A voucher that was decided is never edited or removed (D-022, T-050): a mistake is a new voucher, or the contract is deleted.
CREATE FUNCTION contract_change_vouchers_immutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'PENDING' THEN
            RAISE EXCEPTION 'voucher % was decided and cannot be removed', OLD.voucher_number USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status <> 'PENDING' AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
        RAISE EXCEPTION 'voucher % was decided and cannot change', OLD.voucher_number USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_change_vouchers_immutable"
    BEFORE UPDATE OR DELETE ON "contract_change_vouchers"
    FOR EACH ROW EXECUTE FUNCTION contract_change_vouchers_immutable();

-- The matrix (09_RBAC.md, OQ-023): every kind waits for the Fitness Manager or Admin, and Admin may switch any of them off.
INSERT INTO "approval_rules" ("id", "action_type", "required", "overdue_hours", "updated_at")
SELECT gen_random_uuid(), action, true, 24, CURRENT_TIMESTAMP
FROM unnest(ARRAY['voucher.renewal', 'voucher.upgrade', 'voucher.hold', 'voucher.transfer', 'voucher.branchTransfer',
                  'voucher.conversion', 'voucher.cancellation']) AS action;
INSERT INTO "approval_rule_roles" ("action_type", "role_id")
SELECT action, "id"
FROM "roles", unnest(ARRAY['voucher.renewal', 'voucher.upgrade', 'voucher.hold', 'voucher.transfer',
                           'voucher.branchTransfer', 'voucher.conversion', 'voucher.cancellation']) AS action
WHERE "code" IN ('FITNESS_MANAGER', 'ADMIN');

-- Who raises a voucher: the people who raise contracts.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'contract.change' FROM "role_permissions" WHERE "permission" = 'contract.create';

-- The customer's emails (D-036): a renewal moves the session count and always goes; a hold goes unless Admin switches it off.
INSERT INTO "email_templates" ("event", "subject_vi", "body_vi", "subject_en", "body_en") VALUES
    ('change.renewal', $t$Gia hạn hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) đã được gia hạn theo phiếu {voucherNumber}: thêm {sessionsAdded} buổi, hiệu lực đến {endDate}. Tổng số buổi: {totalSessions}. Số buổi còn lại: {remaining}. Số tiền gia hạn: {amount}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} renewed, voucher {voucherNumber}$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) was renewed by voucher {voucherNumber}: {sessionsAdded} sessions added, valid until {endDate}. Sessions in all: {totalSessions}. Sessions left: {remaining}. Renewal amount: {amount}.

If anything looks wrong, please contact the gym.$t$),
    ('change.hold', $t$Bảo lưu hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) được bảo lưu từ {fromDate} đến {toDate} theo phiếu {voucherNumber}. Ngày hết hạn mới: {endDate} (cộng thêm {addedDays} ngày). Số buổi còn lại: {remaining}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} on hold, voucher {voucherNumber}$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) is on hold from {fromDate} to {toDate} by voucher {voucherNumber}. New end date: {endDate} ({addedDays} days added). Sessions left: {remaining}.

If anything looks wrong, please contact the gym.$t$);
