-- M8.4 (brief §5.6, FR-CHG-001, FR-CHG-002, D-010, D-024, D-034; A-240 to A-247): cancellation by change voucher.
--
-- A cancellation ends the contract at the customer's request: it says why (a reason from the list), the value of the sessions
-- used and the fee kept, and the money given back, which becomes an expense voucher linked to the contract when the voucher is
-- approved. The amount paid is read from the receipts and never typed.
ALTER TABLE "contract_change_vouchers" ADD COLUMN "reason_option_id" UUID;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "reason_note" TEXT;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "value_used" DECIMAL(14,0);
ALTER TABLE "contract_change_vouchers" ADD COLUMN "fee" DECIMAL(14,0);
ALTER TABLE "contract_change_vouchers" ADD COLUMN "refund_method_option_id" UUID;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "refund_method_note" TEXT;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "refund_category_option_id" UUID;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "refund_category_note" TEXT;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "refund_transaction_id" UUID;

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_reason_option_id_fkey"
    FOREIGN KEY ("reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_refund_method_option_id_fkey"
    FOREIGN KEY ("refund_method_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_refund_category_option_id_fkey"
    FOREIGN KEY ("refund_category_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_refund_transaction_id_fkey"
    FOREIGN KEY ("refund_transaction_id") REFERENCES "cash_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "contract_change_vouchers_refund_transaction_id_idx" ON "contract_change_vouchers"("refund_transaction_id");

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_cancellation_check" CHECK (
    ("kind" <> 'CANCELLATION' OR (
        "reason_option_id" IS NOT NULL AND "value_used" IS NOT NULL AND "value_used" >= 0
        AND "fee" IS NOT NULL AND "fee" >= 0 AND "amount" IS NOT NULL
        AND ("amount" = 0 OR ("refund_method_option_id" IS NOT NULL AND "refund_category_option_id" IS NOT NULL))
    ))
    AND ("refund_transaction_id" IS NULL OR "kind" = 'CANCELLATION')
);

-- Why a customer cancels (D-016): only "Khác" to start with; Admin adds the rest.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at") VALUES
    ('c0000000-0000-4000-8000-000000000500', 'cancelReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);
