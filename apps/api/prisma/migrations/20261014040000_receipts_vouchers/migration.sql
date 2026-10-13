-- M4.5 (D-034, D-035, brief §8.1, FR-CASH-001, FR-CASH-002, FR-CASH-004): payments become receipts and cash entries become
-- receipts without a contract and expense vouchers, each with a number that is never reused.

CREATE SEQUENCE receipt_seq;
CREATE SEQUENCE expense_voucher_seq;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "receipt_number" TEXT, ADD COLUMN "sale_employee_id" UUID, ADD COLUMN "note" TEXT;
ALTER TABLE "cash_transactions" ADD COLUMN "number" TEXT, ADD COLUMN "payee" TEXT, ADD COLUMN "method_option_id" UUID,
    ADD COLUMN "method_note" TEXT, ADD COLUMN "contract_id" UUID;

-- Existing records get numbers in the order they were made: receipts (payments and other income) in one series,
-- expenses in the other. The prefixes are the defaults; admin may change them for new numbers (D-038).
CREATE TEMP TABLE receipt_order AS
SELECT id, src, row_number() OVER (ORDER BY created_at, id) AS rn FROM (
    SELECT id, 'payment' AS src, created_at FROM payments
    UNION ALL
    SELECT id, 'cash' AS src, created_at FROM cash_transactions WHERE type = 'INCOME'
) AS receipts;
UPDATE payments p SET receipt_number = 'PT' || lpad(o.rn::text, 6, '0') FROM receipt_order o WHERE o.id = p.id AND o.src = 'payment';
UPDATE cash_transactions c SET number = 'PT' || lpad(o.rn::text, 6, '0') FROM receipt_order o WHERE o.id = c.id AND o.src = 'cash';
SELECT setval('receipt_seq', GREATEST((SELECT count(*) FROM receipt_order), 1), (SELECT count(*) FROM receipt_order) > 0);

CREATE TEMP TABLE expense_order AS
SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM cash_transactions WHERE type = 'EXPENSE';
UPDATE cash_transactions c SET number = 'PC' || lpad(o.rn::text, 6, '0') FROM expense_order o WHERE o.id = c.id;
SELECT setval('expense_voucher_seq', GREATEST((SELECT count(*) FROM expense_order), 1), (SELECT count(*) FROM expense_order) > 0);

-- Before this, entries named no method: they were cash.
UPDATE cash_transactions SET method_option_id = 'c0000000-0000-4000-8000-000000000011';

ALTER TABLE "payments" ALTER COLUMN "receipt_number" SET NOT NULL;
ALTER TABLE "cash_transactions" ALTER COLUMN "number" SET NOT NULL, ALTER COLUMN "method_option_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "payments_receipt_number_key" ON "payments"("receipt_number");
CREATE UNIQUE INDEX "cash_transactions_number_key" ON "cash_transactions"("number");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_employee_id_fkey" FOREIGN KEY ("sale_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_method_option_id_fkey" FOREIGN KEY ("method_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payee is for expenses; a contract link only for an expense (a refund).
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_expense_fields" CHECK ("type" = 'EXPENSE' OR ("payee" IS NULL AND "contract_id" IS NULL));

-- Editing a receipt's date is a permission of its own (D-034): Admin's.
INSERT INTO "role_permissions" ("role_id", "permission") SELECT "id", 'payment.editDate' FROM "roles" WHERE "code" = 'ADMIN';
