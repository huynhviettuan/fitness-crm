-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "contract_code" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "package_name" TEXT NOT NULL,
    "contract_value" DECIMAL(14,0) NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "opening_sessions_used" INTEGER NOT NULL DEFAULT 0,
    "opening_paid_amount" DECIMAL(14,0) NOT NULL DEFAULT 0,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_code_key" ON "contracts"("contract_code");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_idempotency_key_key" ON "contracts"("idempotency_key");

-- CreateIndex
CREATE INDEX "contracts_customer_id_idx" ON "contracts"("customer_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customized (not modeled by Prisma).
-- Contract codes are generated from this sequence as 'HD' + 6 digits (T-019, A-003).
CREATE SEQUENCE "contract_code_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- Guarantees the database itself refuses impossible contracts.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_total_sessions_positive" CHECK ("total_sessions" > 0),
  ADD CONSTRAINT "contracts_opening_sessions_valid" CHECK ("opening_sessions_used" >= 0 AND "opening_sessions_used" <= "total_sessions"),
  ADD CONSTRAINT "contracts_money_not_negative" CHECK ("contract_value" >= 0 AND "opening_paid_amount" >= 0),
  ADD CONSTRAINT "contracts_dates_ordered" CHECK ("end_date" >= "start_date");
