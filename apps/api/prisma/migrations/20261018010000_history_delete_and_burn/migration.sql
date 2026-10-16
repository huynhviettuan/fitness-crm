-- M5.4 (brief §6.3, D-026, D-027, D-028): a session of the check-in history is deleted with a reason (one session
-- refunded, the PT credit removed, the booking to the trash), and Burn Show adds a trained session by hand.
-- Both are Admin's. The deleted session is the booking moved to the status DELETED, whose rule consumes and credits
-- nothing, so the refund and the removed credit are derived (T-050); the columns below keep when it was trained and
-- deleted for the PT's payroll adjustment (M5.7, D-027).
ALTER TABLE "bookings" ADD COLUMN "added_by_hand" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bookings" ADD COLUMN "added_reason_option_id" UUID;
ALTER TABLE "bookings" ADD COLUMN "added_reason_note" TEXT;
ALTER TABLE "bookings" ADD COLUMN "history_deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "bookings" ADD COLUMN "history_deleted_by" UUID;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_added_reason_fkey" FOREIGN KEY ("added_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "bookings_history_deleted_by_fkey" FOREIGN KEY ("history_deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A session added by hand always says why (D-028).
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_added_has_reason" CHECK (NOT "added_by_hand" OR "added_reason_option_id" IS NOT NULL),
  ADD CONSTRAINT "bookings_history_deleted_complete" CHECK (("history_deleted_at" IS NULL) = ("history_deleted_by" IS NULL));

CREATE INDEX "bookings_history_deleted_at_idx" ON "bookings"("history_deleted_at") WHERE "history_deleted_at" IS NOT NULL;

-- The reasons for Burn Show (D-016): a list with "Khác", and two seeded reasons.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-000000000025', 'burnShowReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "updated_at") VALUES
  ('c0000000-0000-4000-8000-000000000026', 'burnShowReasons', 'Khôi phục buổi tập xóa nhầm', 'Restore a session deleted by mistake', 1, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000027', 'burnShowReasons', 'Buổi tập diễn ra không có lịch hẹn', 'The session took place without a booking', 2, CURRENT_TIMESTAMP);

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", p.permission FROM "roles", (VALUES ('session.deleteHistory'), ('session.burn')) AS p(permission)
WHERE "roles"."code" = 'ADMIN';
