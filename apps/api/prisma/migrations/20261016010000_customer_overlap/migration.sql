-- A customer cannot be in two sessions at once, also under concurrent requests (M5.2, D-030, T-014); what holds
-- the slot is the flag the session kept, as for the trainer.
ALTER TABLE "bookings" ADD CONSTRAINT "booking_customer_no_overlap"
  EXCLUDE USING gist (
    "customer_id" WITH =,
    tstzrange("scheduled_start", "scheduled_end", '[)') WITH &&
  )
  WHERE ("holds_slot");
