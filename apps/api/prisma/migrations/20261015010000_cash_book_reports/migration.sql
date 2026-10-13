-- M4.7 (brief §8.1, §9, FR-CASH-005, A-138): the cash book needs the cash a branch held in each payment method when its
-- books begin. One row per branch and method; the cash book counts movements from `effective_on`. An admin sets it and
-- every change is audited with before and after values.
CREATE TABLE "cash_opening_balances" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "method_option_id" UUID NOT NULL,
    "effective_on" DATE NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_opening_balances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_opening_balances_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "cash_opening_balances_branch_id_method_option_id_key"
    ON "cash_opening_balances"("branch_id", "method_option_id");

ALTER TABLE "cash_opening_balances"
    ADD CONSTRAINT "cash_opening_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cash_opening_balances_method_option_id_fkey" FOREIGN KEY ("method_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cash_opening_balances_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reports (A-139): each report and its export is its own permission. The money reports go to Admin, Fitness Manager
-- and Accountant; the contract and exception-price reports to Admin and Fitness Manager (09_RBAC.md).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY[
    'report.cashBook', 'report.cashBookExport', 'report.incomeExpense', 'report.incomeExpenseExport',
    'report.memberDebtExport'
]) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'ACCOUNTANT');

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY[
    'report.contracts', 'report.contractsExport', 'report.exceptionPrices', 'report.exceptionPricesExport'
]) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');

-- Setting the opening balance moves every closing balance after it: Admin only.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'cash.opening' FROM "roles" WHERE "code" = 'ADMIN';
