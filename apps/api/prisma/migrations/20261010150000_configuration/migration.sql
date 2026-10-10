-- M1 slice 3: option lists (D-016) and system parameters (T-049). Hand-written so
-- existing payments and cash entries keep their method, category, and void reason.

-- CreateTable
CREATE TABLE "options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "list_key" TEXT NOT NULL,
    "label_vi" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_other" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_parameters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "options_list_key_label_vi_key" ON "options"("list_key", "label_vi");
CREATE INDEX "options_list_key_sort_order_idx" ON "options"("list_key", "sort_order");
CREATE UNIQUE INDEX "system_parameters_key_key" ON "system_parameters"("key");

-- Customized (not modeled by Prisma). D-016: one "Khác" per list, and it is never
-- made inactive, so it can always be chosen.
CREATE UNIQUE INDEX "options_one_other_per_list" ON "options"("list_key") WHERE "is_other";
ALTER TABLE "options" ADD CONSTRAINT "options_other_always_active" CHECK (NOT "is_other" OR "active");

-- Initial options, with fixed ids so tests can restore them. "Khác" is listed last
-- whatever its sort order.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other") VALUES
    ('c0000000-0000-4000-8000-000000000001', 'paymentMethods', 'Khác', 'Other', 0, true),
    ('c0000000-0000-4000-8000-000000000002', 'incomeCategories', 'Khác', 'Other', 0, true),
    ('c0000000-0000-4000-8000-000000000003', 'expenseTypes', 'Khác', 'Other', 0, true),
    ('c0000000-0000-4000-8000-000000000004', 'deleteReasons', 'Khác', 'Other', 0, true);
-- brief §8.1: cash, bank transfer, card. E-wallet (A-020) stays on old payments only.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "active") VALUES
    ('c0000000-0000-4000-8000-000000000011', 'paymentMethods', 'Tiền mặt', 'Cash', 1, true),
    ('c0000000-0000-4000-8000-000000000012', 'paymentMethods', 'Chuyển khoản', 'Bank transfer', 2, true),
    ('c0000000-0000-4000-8000-000000000013', 'paymentMethods', 'Thẻ', 'Card', 3, true),
    ('c0000000-0000-4000-8000-000000000014', 'paymentMethods', 'Ví điện tử', 'E-wallet', 4, false);
-- Cash categories typed so far become the first options of their list.
INSERT INTO "options" ("list_key", "label_vi", "label_en", "sort_order")
SELECT
    CASE "type" WHEN 'INCOME' THEN 'incomeCategories' ELSE 'expenseTypes' END,
    "category",
    "category",
    ROW_NUMBER() OVER (PARTITION BY "type" ORDER BY MIN("created_at"))
FROM "cash_transactions"
WHERE "category" <> 'Khác'
GROUP BY "type", "category";

-- Payments: method and void reason from the lists.
ALTER TABLE "payments"
    ADD COLUMN "method_option_id" UUID,
    ADD COLUMN "method_note" TEXT,
    ADD COLUMN "void_reason_option_id" UUID,
    ADD COLUMN "void_reason_note" TEXT;
UPDATE "payments" AS p SET "method_option_id" = o."id"
FROM "options" AS o
WHERE o."list_key" = 'paymentMethods' AND NOT o."is_other" AND o."label_en" = CASE p."method"
    WHEN 'CASH' THEN 'Cash' WHEN 'BANK_TRANSFER' THEN 'Bank transfer' WHEN 'CARD' THEN 'Card' ELSE 'E-wallet' END;
-- Reasons typed so far are kept as "Khác" with the text as its note.
UPDATE "payments" SET
    "void_reason_option_id" = (SELECT "id" FROM "options" WHERE "list_key" = 'deleteReasons' AND "is_other"),
    "void_reason_note" = "void_reason"
WHERE "void_reason" IS NOT NULL;
ALTER TABLE "payments" DROP CONSTRAINT "payments_void_complete";
ALTER TABLE "payments" ALTER COLUMN "method_option_id" SET NOT NULL, DROP COLUMN "method", DROP COLUMN "void_reason";
-- A-008: a voided payment always records when, by whom, and why.
ALTER TABLE "payments" ADD CONSTRAINT "payments_void_complete" CHECK (
    ("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason_option_id" IS NOT NULL)
);
DROP TYPE "PaymentMethod";

-- Cash entries: category and void reason from the lists.
ALTER TABLE "cash_transactions"
    ADD COLUMN "category_option_id" UUID,
    ADD COLUMN "category_note" TEXT,
    ADD COLUMN "void_reason_option_id" UUID,
    ADD COLUMN "void_reason_note" TEXT;
UPDATE "cash_transactions" AS c SET "category_option_id" = o."id"
FROM "options" AS o
WHERE o."list_key" = CASE c."type" WHEN 'INCOME' THEN 'incomeCategories' ELSE 'expenseTypes' END
  AND (o."label_vi" = c."category" OR (c."category" = 'Khác' AND o."is_other"));
UPDATE "cash_transactions" SET
    "void_reason_option_id" = (SELECT "id" FROM "options" WHERE "list_key" = 'deleteReasons' AND "is_other"),
    "void_reason_note" = "void_reason"
WHERE "void_reason" IS NOT NULL;
ALTER TABLE "cash_transactions" DROP CONSTRAINT "cash_transactions_void_complete";
ALTER TABLE "cash_transactions" ALTER COLUMN "category_option_id" SET NOT NULL, DROP COLUMN "category", DROP COLUMN "void_reason";
-- A-009
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_void_complete" CHECK (
    ("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason_option_id" IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_option_id_fkey" FOREIGN KEY ("method_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_void_reason_option_id_fkey" FOREIGN KEY ("void_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_category_option_id_fkey" FOREIGN KEY ("category_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_void_reason_option_id_fkey" FOREIGN KEY ("void_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The admin role manages configuration (09_RBAC.md).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'config.manage' FROM "roles" WHERE "code" = 'ADMIN';

-- The defaults above only served the initial rows; Prisma sets ids and timestamps.
ALTER TABLE "options" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "system_parameters" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT;
