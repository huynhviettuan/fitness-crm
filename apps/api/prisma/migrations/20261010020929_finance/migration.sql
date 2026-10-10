-- CreateEnum
CREATE TYPE "MoneyRecordStatus" AS ENUM ('CONFIRMED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET');

-- CreateEnum
CREATE TYPE "CashTransactionType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_on" DATE NOT NULL,
    "status" "MoneyRecordStatus" NOT NULL DEFAULT 'CONFIRMED',
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" UUID NOT NULL,
    "type" "CashTransactionType" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "occurred_on" DATE NOT NULL,
    "status" "MoneyRecordStatus" NOT NULL DEFAULT 'CONFIRMED',
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_contract_id_status_idx" ON "payments"("contract_id", "status");

-- CreateIndex
CREATE INDEX "payments_paid_on_idx" ON "payments"("paid_on");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_idempotency_key_key" ON "cash_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "cash_transactions_occurred_on_idx" ON "cash_transactions"("occurred_on");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customized (not modeled by Prisma).
-- BR-014: amounts are positive; for cash, `type` carries the direction.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  -- A-008: a voided payment always records when, by whom, and why.
  ADD CONSTRAINT "payments_void_complete" CHECK (
    ("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)
  );

ALTER TABLE "cash_transactions"
  ADD CONSTRAINT "cash_transactions_amount_positive" CHECK ("amount" > 0),
  -- A-009
  ADD CONSTRAINT "cash_transactions_void_complete" CHECK (
    ("status" = 'VOIDED') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)
  );
