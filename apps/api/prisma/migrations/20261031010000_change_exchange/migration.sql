-- M8.2 (brief §5.6, FR-CHG-001, D-024; A-227 to A-231): upgrade and conversion. Both exchange what is left of the package for
-- a new one on the same contract: the voucher keeps the service exchanged for and the value credited for the sessions left;
-- its effect (sessions and value added) is worked out at approval and summed into the contract by the M8.1 trigger.
ALTER TABLE "contract_change_vouchers" ADD COLUMN "target_service_id" UUID;
ALTER TABLE "contract_change_vouchers" ADD COLUMN "credit" DECIMAL(14,0);

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_target_service_id_fkey"
    FOREIGN KEY ("target_service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "contract_change_vouchers_target_service_id_idx" ON "contract_change_vouchers"("target_service_id");

ALTER TABLE "contract_change_vouchers" ADD CONSTRAINT "contract_change_vouchers_exchange_check" CHECK (
    ("kind" NOT IN ('UPGRADE', 'CONVERSION')
        OR ("target_service_id" IS NOT NULL AND COALESCE("sessions", 0) > 0 AND "amount" IS NOT NULL AND "credit" IS NOT NULL
            AND "credit" <= "amount"))
    AND ("credit" IS NULL OR "credit" >= 0)
);

-- The customer's emails (D-036): both move the session count, so both always go.
INSERT INTO "email_templates" ("event", "subject_vi", "body_vi", "subject_en", "body_en") VALUES
    ('change.upgrade', $t$Nâng cấp hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} đã được nâng cấp lên {targetService} theo phiếu {voucherNumber}. Số buổi thay đổi {sessionsAdded}; số buổi còn lại: {remaining}. Số tiền phải trả thêm: {amount}. Hiệu lực đến {endDate}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} upgraded, voucher {voucherNumber}$t$, $t$Hello {customerName},

Contract {contractCode} was upgraded to {targetService} by voucher {voucherNumber}. Sessions changed by {sessionsAdded}; sessions left: {remaining}. Extra amount to pay: {amount}. Valid until {endDate}.

If anything looks wrong, please contact the gym.$t$),
    ('change.conversion', $t$Chuyển đổi hợp đồng {contractCode}, phiếu {voucherNumber}$t$, $t$Chào {customerName},

Hợp đồng {contractCode} đã được chuyển đổi sang {targetService} theo phiếu {voucherNumber}. Số buổi thay đổi {sessionsAdded}; số buổi còn lại: {remaining}. Số tiền phải trả thêm: {amount}. Hiệu lực đến {endDate}.

Nếu có điều gì chưa đúng, xin liên hệ phòng tập.$t$, $t$Contract {contractCode} converted, voucher {voucherNumber}$t$, $t$Hello {customerName},

Contract {contractCode} was converted to {targetService} by voucher {voucherNumber}. Sessions changed by {sessionsAdded}; sessions left: {remaining}. Extra amount to pay: {amount}. Valid until {endDate}.

If anything looks wrong, please contact the gym.$t$);
