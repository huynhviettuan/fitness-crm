-- M4.4a: the opening balances of a contract brought over at go-live (D-011) are set by the import, not by the sale,
-- so they are not part of what the lock after approval protects. Everything else stays locked (A-122).
CREATE OR REPLACE FUNCTION contracts_lock() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('ACTIVE', 'CANCELLED') AND (
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
