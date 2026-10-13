-- M5.1 (brief §6.2, D-025, D-029, T-050, A-145 to A-148): session statuses are configuration, and each session keeps the
-- flags of the rule applied when its status was set, so changing a rule later never rewrites history.
CREATE TABLE "session_statuses" (
    "code" TEXT NOT NULL,
    "label_vi" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    -- Whether a session in this status uses one of the contract's sessions, and credits the PT.
    "consumes" BOOLEAN NOT NULL,
    "credits_pt" BOOLEAN NOT NULL,
    -- Whether it still holds the trainer's time slot (A-024).
    "holds_slot" BOOLEAN NOT NULL,
    -- Once set, the status cannot be changed (D-026).
    "locks_on_set" BOOLEAN NOT NULL,
    -- The badge color, one of the design tokens.
    "color" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_statuses_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "session_statuses_color_check" CHECK ("color" IN ('success', 'warning', 'info', 'muted', 'destructive'))
);

-- The brief's table (D-025). Booking itself never consumes.
INSERT INTO "session_statuses" ("code", "label_vi", "label_en", "consumes", "credits_pt", "holds_slot", "locks_on_set", "color", "sort_order") VALUES
    ('BOOKED', 'Booked', 'Booked', false, false, true, false, 'destructive', 1),
    ('TRAINED', 'Đã tập', 'Trained', true, true, true, true, 'info', 2),
    ('CANCELLED', 'Hủy lịch', 'Cancelled', false, false, false, false, 'muted', 3),
    ('NO_SHOW', 'Khách không đến', 'No-show', true, true, true, false, 'warning', 4);

-- Statuses become text keys of that table. COMPLETED is Đã tập; CHECKED_IN is a booking still waiting, with its
-- check-in kept on the session record.
ALTER TABLE "bookings" DROP CONSTRAINT "booking_trainer_no_overlap";
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE TEXT USING (
    CASE "status"::text WHEN 'COMPLETED' THEN 'TRAINED' WHEN 'CHECKED_IN' THEN 'BOOKED' ELSE "status"::text END
);
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'BOOKED';
DROP TYPE "BookingStatus";

-- The rule applied when the status was set, and when and by whom (T-050).
ALTER TABLE "bookings"
    ADD COLUMN "consumes" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "credits_pt" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "holds_slot" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "status_set_at" TIMESTAMPTZ(3),
    ADD COLUMN "status_set_by" UUID;

UPDATE "bookings" b
SET "consumes" = s."consumes", "credits_pt" = s."credits_pt", "holds_slot" = s."holds_slot",
    "status_set_at" = CASE WHEN b."status" = 'BOOKED' THEN NULL ELSE b."updated_at" END
FROM "session_statuses" s
WHERE s."code" = b."status";

ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_status_fkey" FOREIGN KEY ("status") REFERENCES "session_statuses"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "bookings_status_set_by_fkey" FOREIGN KEY ("status_set_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A trainer cannot teach two sessions at once, also under concurrent requests (T-014); what holds the slot is the
-- flag the session kept.
ALTER TABLE "bookings" ADD CONSTRAINT "booking_trainer_no_overlap"
  EXCLUDE USING gist (
    "trainer_id" WITH =,
    tstzrange("scheduled_start", "scheduled_end", '[)') WITH &&
  )
  WHERE ("holds_slot");

CREATE INDEX "bookings_contract_id_consumes_idx" ON "bookings"("contract_id") WHERE "consumes";
