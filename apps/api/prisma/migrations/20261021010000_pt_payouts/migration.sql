-- M5.7 (brief §6.3, §8.1, D-027, D-032, FR-CASH-003): PT payouts. A payout is an expense voucher for one PT and a period of
-- the allocation report, with the sessions it paid, so no session is paid twice (INT-011). Deleting a paid session from the
-- history later is a negative line in the PT's next payout.
CREATE TABLE "pt_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "session_amount" DECIMAL(14,0) NOT NULL,
    "adjustment_amount" DECIMAL(14,0) NOT NULL,
    "session_count" INTEGER NOT NULL,
    "adjustment_count" INTEGER NOT NULL,
    "cash_transaction_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pt_payouts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pt_payouts_period_check" CHECK ("period_to" >= "period_from"),
    CONSTRAINT "pt_payouts_amount_check" CHECK ("amount" > 0 AND "amount" = "session_amount" + "adjustment_amount"),
    CONSTRAINT "pt_payouts_counts_check" CHECK ("session_count" >= 0 AND "adjustment_count" >= 0)
);

CREATE TABLE "pt_payout_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payout_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,0) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    CONSTRAINT "pt_payout_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pt_payout_lines_kind_check" CHECK (
        ("kind" = 'SESSION' AND "amount" >= 0) OR ("kind" = 'ADJUSTMENT' AND "amount" <= 0)
    )
);

CREATE UNIQUE INDEX "pt_payouts_cash_transaction_id_key" ON "pt_payouts"("cash_transaction_id");
CREATE UNIQUE INDEX "pt_payouts_idempotency_key_key" ON "pt_payouts"("idempotency_key");
CREATE INDEX "pt_payouts_trainer_id_period_from_idx" ON "pt_payouts"("trainer_id", "period_from");
CREATE INDEX "pt_payouts_branch_id_idx" ON "pt_payouts"("branch_id");
CREATE INDEX "pt_payout_lines_payout_id_idx" ON "pt_payout_lines"("payout_id");
CREATE INDEX "pt_payout_lines_booking_id_idx" ON "pt_payout_lines"("booking_id");

-- A session is paid once, and taken back once, while its payout stands: the database refuses a second live line, also
-- under concurrent requests.
CREATE UNIQUE INDEX "pt_payout_lines_live_key" ON "pt_payout_lines"("booking_id", "kind") WHERE "released_at" IS NULL;

ALTER TABLE "pt_payouts"
    ADD CONSTRAINT "pt_payouts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "pt_payouts_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "pt_payouts_cash_transaction_id_fkey" FOREIGN KEY ("cash_transaction_id") REFERENCES "cash_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "pt_payouts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pt_payout_lines"
    ADD CONSTRAINT "pt_payout_lines_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "pt_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "pt_payout_lines_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "pt_payout_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A payout is void when its voucher is deleted to the trash or rejected: its sessions are payable again, and the
-- adjustments it applied are pending again. One trigger covers every way the voucher can end (direct deletion,
-- an approved deletion, a rejected or cancelled request).
CREATE FUNCTION "pt_payout_release"() RETURNS trigger AS $$
BEGIN
    IF (NEW."deleted_at" IS NOT NULL OR NEW."approval_status" IN ('REJECTED', 'CANCELLED'))
       AND OLD."deleted_at" IS NULL AND OLD."approval_status" NOT IN ('REJECTED', 'CANCELLED') THEN
        UPDATE "pt_payout_lines" SET "released_at" = now()
        WHERE "released_at" IS NULL
          AND "payout_id" IN (SELECT "id" FROM "pt_payouts" WHERE "cash_transaction_id" = NEW."id");
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pt_payout_release_trigger"
    AFTER UPDATE OF "deleted_at", "approval_status" ON "cash_transactions"
    FOR EACH ROW EXECUTE FUNCTION "pt_payout_release"();

-- The payouts are the books': Admin, Fitness Manager and Accountant, as the PT revenue report is.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY['payout.view', 'payout.create']) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'ACCOUNTANT');
