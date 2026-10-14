-- M8.3 (brief §5.6, FR-CHG-001, D-024; A-232 to A-239): transfer and branch transfer.
--
-- A transfer gives the sessions left of a contract to another customer: the voucher names the receiver and the value that goes
-- with the sessions; approving it empties the contract given away and makes a new contract of its own type for the receiver.
-- A branch transfer moves a contract to another branch for a fee; it is the one change the lock after approval lets through,
-- and only when an approved voucher says so.
-- A contract that follows another is a renewal or a transfer.
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_previous_check";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previous_check" CHECK (
    "previous_contract_id" IS NULL OR "contract_type" IN ('RENEW', 'TRANSFER')
);

ALTER TABLE "contract_change_vouchers" ADD COLUMN "to_customer_id" UUID;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "new_contract_id" UUID;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "to_branch_id" UUID;

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_to_customer_id_fkey"
    FOREIGN KEY ("to_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_new_contract_id_fkey"
    FOREIGN KEY ("new_contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_to_branch_id_fkey"
    FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "contract_change_vouchers_to_customer_id_idx" ON "contract_change_vouchers"("to_customer_id");
CREATE INDEX "contract_change_vouchers_new_contract_id_idx" ON "contract_change_vouchers"("new_contract_id");

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_transfer_check" CHECK (
    ("kind" <> 'TRANSFER' OR ("to_customer_id" IS NOT NULL AND "credit" IS NOT NULL AND "to_customer_id" <> "customer_id"))
    AND ("kind" <> 'BRANCH_TRANSFER' OR ("to_branch_id" IS NOT NULL AND "amount" IS NOT NULL AND "to_branch_id" <> "branch_id"))
    AND ("new_contract_id" IS NULL OR "kind" = 'TRANSFER')
);

-- The lock after approval (D-022) lets the branch change, and only the branch, when an approved branch transfer voucher of the
-- contract names the branch it goes to (A-235).
CREATE OR REPLACE FUNCTION contracts_lock() RETURNS trigger AS $$
BEGIN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND OLD.status IN ('ACTIVE', 'CANCELLED', 'FROZEN') AND NOT EXISTS (
        SELECT 1 FROM contract_change_vouchers
        WHERE contract_id = OLD.id AND kind = 'BRANCH_TRANSFER' AND status = 'APPROVED' AND to_branch_id = NEW.branch_id
    ) THEN
        RAISE EXCEPTION 'contract % is locked after approval', OLD.contract_code USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('ACTIVE', 'CANCELLED', 'FROZEN') AND (
        NEW.customer_id, NEW.service_id, NEW.price_tier_id, NEW.contract_type, NEW.previous_contract_id,
        NEW.contract_date, NEW.contract_value, NEW.total_sessions, NEW.bonus_sessions, NEW.bonus_months, NEW.bonus_days,
        NEW.tier_months, NEW.tier_days, NEW.start_date, NEW.activation_deadline, NEW.tier_unit_price,
        NEW.approved_unit_price, NEW.is_exception_price, NEW.exception_reason_option_id, NEW.exception_note,
        NEW.promotion_id, NEW.voucher_id, NEW.promotion_discount, NEW.voucher_discount, NEW.vat_percent,
        NEW.vat_amount, NEW.package_name, NEW.contract_code
    ) IS DISTINCT FROM (
        OLD.customer_id, OLD.service_id, OLD.price_tier_id, OLD.contract_type, OLD.previous_contract_id,
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

-- The customer's emails (D-036): a transfer moves the session count of both customers, so both always go; a branch transfer
-- goes unless Admin switches it off.
INSERT INTO "email_templates" ("event", "subject_vi", "body_vi", "subject_en", "body_en") VALUES
    ('change.transferOut', $t$Chuyển nhượng hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) đã được chuyển nhượng cho {otherParty} theo phiếu {voucherNumber}: {sessionsAdded} buổi còn lại không còn thuộc hợp đồng của bạn. Các buổi đã đặt từ hôm nay đã bị hủy.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} transferred, voucher {voucherNumber}$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) was transferred to {otherParty} by voucher {voucherNumber}: the {sessionsAdded} sessions left are no longer on your contract. Sessions booked from today were cancelled.

If anything looks wrong, please contact the gym.$t$),
    ('change.transferIn', $t$Bạn nhận chuyển nhượng hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

{otherParty} đã chuyển nhượng cho bạn hợp đồng {contractCode} ({packageName}) theo phiếu {voucherNumber}: {remaining} buổi, hiệu lực đến {endDate}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} transferred to you, voucher {voucherNumber}$t$, $t$Hello {customerName},

{otherParty} transferred contract {contractCode} ({packageName}) to you by voucher {voucherNumber}: {remaining} sessions, valid until {endDate}.

If anything looks wrong, please contact the gym.$t$),
    ('change.branchTransfer', $t$Chuyển chi nhánh hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} ({packageName}) được chuyển sang {targetBranch} theo phiếu {voucherNumber}. Phí chuyển: {amount}. Các buổi đã đặt từ hôm nay đã bị hủy, vui lòng đặt lại tại chi nhánh mới.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} moved to another branch, voucher {voucherNumber}$t$, $t$Hello {customerName},

Contract {contractCode} ({packageName}) was moved to {targetBranch} by voucher {voucherNumber}. Transfer fee: {amount}. Sessions booked from today were cancelled; please book again at the new branch.

If anything looks wrong, please contact the gym.$t$);
