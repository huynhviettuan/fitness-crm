-- CreateEnum
CREATE TYPE "TrainerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "trainers" (
    "id" UUID NOT NULL,
    "trainer_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "status" "TrainerStatus" NOT NULL DEFAULT 'ACTIVE',
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trainers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "scheduled_start" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ(3) NOT NULL,
    "checked_in_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trainers_trainer_code_key" ON "trainers"("trainer_code");

-- CreateIndex
CREATE UNIQUE INDEX "trainers_user_id_key" ON "trainers"("user_id");

-- CreateIndex
CREATE INDEX "bookings_contract_id_status_idx" ON "bookings"("contract_id", "status");

-- CreateIndex
CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");

-- CreateIndex
CREATE INDEX "bookings_trainer_id_scheduled_start_idx" ON "bookings"("trainer_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "bookings_scheduled_start_idx" ON "bookings"("scheduled_start");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_booking_id_key" ON "sessions"("booking_id");

-- AddForeignKey
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customized (not modeled by Prisma).
-- Trainer codes are generated from this sequence as 'PT' + 3 digits (T-019, A-003).
CREATE SEQUENCE "trainer_code_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- BR-011: a booking ends after it starts.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_ordered" CHECK ("scheduled_end" > "scheduled_start");

-- A session's completion facts are recorded together or not at all.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_completion_complete" CHECK (("completed_at" IS NULL) = ("completed_by" IS NULL));

-- BR-010, T-014: one trainer never has two active bookings at the same time, even when
-- two requests arrive together. Ranges are half-open, so back-to-back bookings are
-- allowed (A-004); CANCELLED and NO_SHOW free the slot (A-005). Violations raise
-- SQLSTATE 23P01, mapped to BOOKING_TRAINER_OVERLAP.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings" ADD CONSTRAINT "booking_trainer_no_overlap"
  EXCLUDE USING gist (
    "trainer_id" WITH =,
    tstzrange("scheduled_start", "scheduled_end", '[)') WITH &&
  )
  WHERE ("status" IN ('BOOKED', 'CHECKED_IN', 'COMPLETED'));
