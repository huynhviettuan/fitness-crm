-- M7.4 (brief §7.4, FR-WKO-004; A-206 to A-211): the escalation. A set whose Action is "Dừng + Escalation" raises one, once.
-- It tells the manager and the Master at once, waits as a task in Giao việc, and is closed by one of them marking it seen
-- with a direction. What it says is copied when it is raised.
CREATE TABLE "workout_escalations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "log_id" UUID NOT NULL,
    "set_id" UUID,
    "exercise_id" UUID NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "set_no" INTEGER NOT NULL,
    "flag_option_id" UUID NOT NULL,
    "flag_note" TEXT,
    "action_note" TEXT,
    "note" TEXT,
    "raised_by" UUID NOT NULL,
    "raised_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "task_id" UUID,
    "seen_by" UUID,
    "seen_at" TIMESTAMPTZ(3),
    "direction" TEXT,
    CONSTRAINT "workout_escalations_pkey" PRIMARY KEY ("id"),
    -- Seen means who, when and a direction; waiting means none of them.
    CONSTRAINT "workout_escalations_seen_check" CHECK (
        ("seen_at" IS NULL AND "seen_by" IS NULL AND "direction" IS NULL)
        OR ("seen_at" IS NOT NULL AND "seen_by" IS NOT NULL AND "direction" IS NOT NULL AND btrim("direction") <> '')
    )
);

CREATE UNIQUE INDEX "workout_escalations_set_id_key" ON "workout_escalations"("set_id");
CREATE UNIQUE INDEX "workout_escalations_task_id_key" ON "workout_escalations"("task_id");
CREATE INDEX "workout_escalations_log_id_idx" ON "workout_escalations"("log_id");
CREATE INDEX "workout_escalations_seen_at_idx" ON "workout_escalations"("seen_at");

ALTER TABLE "workout_escalations" ADD CONSTRAINT "workout_escalations_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "workout_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_escalations" ADD CONSTRAINT "workout_escalations_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "workout_log_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workout_escalations" ADD CONSTRAINT "workout_escalations_flag_option_id_fkey" FOREIGN KEY ("flag_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_escalations" ADD CONSTRAINT "workout_escalations_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_escalations" ADD CONSTRAINT "workout_escalations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workout_escalations" ADD CONSTRAINT "workout_escalations_seen_by_fkey" FOREIGN KEY ("seen_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The escalation goes out by email and push as well (D-053); the email starts mandatory, as a stopped session must not be missed.
INSERT INTO "staff_notification_settings" ("kind", "email_mandatory", "push_mandatory") VALUES ('workoutEscalation', true, false);
