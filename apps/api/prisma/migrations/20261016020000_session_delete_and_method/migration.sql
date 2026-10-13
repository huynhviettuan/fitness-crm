-- M5.3 (brief §6.2, D-025, D-026, D-069): Xóa, a Booked session booked by mistake, is a status of its own that
-- consumes nothing, credits nobody, and frees the slot; and a confirmed session records how it was confirmed.
INSERT INTO "session_statuses" ("code", "label_vi", "label_en", "consumes", "credits_pt", "holds_slot", "locks_on_set", "color", "sort_order")
VALUES ('DELETED', 'Xóa', 'Deleted', false, false, false, true, 'muted', 5);

ALTER TABLE "sessions" ADD COLUMN "confirmation_method" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_confirmation_method_check" CHECK ("confirmation_method" IN ('MANUAL', 'DEVICE'));

-- Deleting a booked session: Admin and Fitness Manager.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'booking.delete' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');
