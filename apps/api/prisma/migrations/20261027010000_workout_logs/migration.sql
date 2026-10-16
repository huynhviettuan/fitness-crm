-- M7.3 (brief §7.3, FR-WKO-003, D-033; A-199 to A-205): the session log. One log per PT session, in three parts: before
-- (stress, energy, impact), during (one row per set with the plan and the actual side by side, a Flag and an Action) and after
-- (sRPE, energy, summary, the coach's notes). The plan's targets are copied onto each set when the log is made, so a later
-- revision of the plan does not move what was logged.
CREATE TABLE "workout_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "plan_id" UUID,
    "plan_session_id" UUID,
    "goal" TEXT,
    "pre_stress" INTEGER,
    "pre_stress_note" TEXT,
    "pre_energy" INTEGER,
    "pre_energy_note" TEXT,
    "pre_impact_option_id" UUID,
    "pre_impact_note" TEXT,
    "post_srpe" INTEGER,
    "post_srpe_note" TEXT,
    "post_energy" INTEGER,
    "post_energy_note" TEXT,
    "post_summary_option_id" UUID,
    "post_summary_note" TEXT,
    "coach_notes" TEXT,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_logs_pkey" PRIMARY KEY ("id"),
    -- The scales of the brief, 1 to 10 (A-203).
    CONSTRAINT "workout_logs_scales_check" CHECK (
        ("pre_stress" IS NULL OR "pre_stress" BETWEEN 1 AND 10)
        AND ("pre_energy" IS NULL OR "pre_energy" BETWEEN 1 AND 10)
        AND ("post_srpe" IS NULL OR "post_srpe" BETWEEN 1 AND 10)
        AND ("post_energy" IS NULL OR "post_energy" BETWEEN 1 AND 10)
    )
);

CREATE TABLE "workout_log_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "log_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "plan_item_id" UUID,
    "position" INTEGER NOT NULL,
    CONSTRAINT "workout_log_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workout_log_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "set_no" INTEGER NOT NULL,
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "plan_weight" DECIMAL(7,2),
    "plan_reps" INTEGER,
    "plan_rest_seconds" INTEGER,
    "plan_rir" INTEGER,
    "plan_tempo" TEXT,
    "plan_technique" TEXT,
    "plan_video_url" TEXT,
    "plan_duration_minutes" DECIMAL(6,1),
    "plan_speed" DECIMAL(5,1),
    "plan_heart_rate" INTEGER,
    "plan_notes" TEXT,
    "weight" DECIMAL(7,2),
    "reps" INTEGER,
    "rir" INTEGER,
    "duration_minutes" DECIMAL(6,1),
    "speed" DECIMAL(5,1),
    "heart_rate" INTEGER,
    "flag_option_id" UUID NOT NULL,
    "flag_note" TEXT,
    "action_option_id" UUID NOT NULL,
    "action_note" TEXT,
    "note" TEXT,
    CONSTRAINT "workout_log_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_log_sets_actuals_check" CHECK (
        ("weight" IS NULL OR "weight" >= 0)
        AND ("reps" IS NULL OR "reps" >= 0)
        AND ("rir" IS NULL OR "rir" BETWEEN 0 AND 10)
        AND ("duration_minutes" IS NULL OR "duration_minutes" >= 0)
        AND ("speed" IS NULL OR "speed" >= 0)
        AND ("heart_rate" IS NULL OR "heart_rate" BETWEEN 0 AND 250)
    )
);

CREATE UNIQUE INDEX "workout_logs_booking_id_key" ON "workout_logs"("booking_id");
CREATE INDEX "workout_logs_customer_id_created_at_idx" ON "workout_logs"("customer_id", "created_at");
CREATE INDEX "workout_logs_trainer_id_idx" ON "workout_logs"("trainer_id");
CREATE INDEX "workout_logs_branch_id_idx" ON "workout_logs"("branch_id");
CREATE INDEX "workout_logs_plan_id_idx" ON "workout_logs"("plan_id");
CREATE INDEX "workout_log_items_log_id_idx" ON "workout_log_items"("log_id");
CREATE INDEX "workout_log_items_exercise_id_idx" ON "workout_log_items"("exercise_id");
CREATE INDEX "workout_log_sets_item_id_idx" ON "workout_log_sets"("item_id");
CREATE INDEX "workout_log_sets_flag_option_id_idx" ON "workout_log_sets"("flag_option_id");
CREATE INDEX "workout_log_sets_action_option_id_idx" ON "workout_log_sets"("action_option_id");

ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "workout_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_plan_session_id_fkey" FOREIGN KEY ("plan_session_id") REFERENCES "workout_plan_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_pre_impact_option_id_fkey" FOREIGN KEY ("pre_impact_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_post_summary_option_id_fkey" FOREIGN KEY ("post_summary_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_log_items" ADD CONSTRAINT "workout_log_items_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "workout_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_log_items" ADD CONSTRAINT "workout_log_items_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "workout_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_log_items" ADD CONSTRAINT "workout_log_items_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "workout_plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workout_log_sets" ADD CONSTRAINT "workout_log_sets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "workout_log_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_log_sets" ADD CONSTRAINT "workout_log_sets_flag_option_id_fkey" FOREIGN KEY ("flag_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_log_sets" ADD CONSTRAINT "workout_log_sets_action_option_id_fkey" FOREIGN KEY ("action_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who writes a log (Admin, the manager, the PT: their own sessions); everyone who reads plans reads logs (`workout.view`).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'workout.log' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'PT');
