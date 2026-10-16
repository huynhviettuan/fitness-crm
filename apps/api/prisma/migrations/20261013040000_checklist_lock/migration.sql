-- M2.7 step 4: the checklist lock (D-054).

-- A step that passed its deadline and the grace period locks as "Không thực hiện".
ALTER TABLE "lead_steps" ADD COLUMN "locked_at" TIMESTAMPTZ(3);
CREATE INDEX "lead_steps_locked_at_idx" ON "lead_steps"("locked_at");

-- Why admin removed a tick (D-016): only "Khác" until the owner names the reasons.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-000000000020', 'stepReopenReasons', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);

-- Only Admin removes a tick.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'lead.untick' FROM "roles" WHERE "code" = 'ADMIN';
