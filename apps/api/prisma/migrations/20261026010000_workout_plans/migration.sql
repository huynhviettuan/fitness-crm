-- M7.2 (brief §7.1, §7.2, FR-WKO-001, FR-WKO-002, D-033, D-018; A-192 to A-198): plan templates and customer plans. One
-- structure serves both: a plan has stages (from the catalog), a stage has sessions, a session has exercises, an exercise has
-- sets with their targets. A template has one session per stage; a customer plan has its sessions by week. A plan is
-- written as a draft, goes to the Master for approval (the matrix row "Tạo và sửa giáo án, template"), and is then never
-- edited: a change is a revision, a new draft that replaces the plan when it is approved.
CREATE TYPE "PlanKind" AS ENUM ('TEMPLATE', 'CUSTOMER');
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "workout_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "PlanKind" NOT NULL,
    "name" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID,
    "contract_id" UUID,
    "trainer_id" UUID,
    "plan_date" DATE NOT NULL,
    "phase" TEXT,
    "goal" TEXT,
    "notes" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    -- A template can be retired; a customer plan is replaced by a revision instead.
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source_template_id" UUID,
    "previous_plan_id" UUID,
    "pt_evaluation" TEXT,
    "pt_note" TEXT,
    "master_evaluation" TEXT,
    "master_note" TEXT,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_plans_kind_check" CHECK (
        ("kind" = 'TEMPLATE' AND "customer_id" IS NULL AND "contract_id" IS NULL)
        OR ("kind" = 'CUSTOMER' AND "customer_id" IS NOT NULL AND "contract_id" IS NOT NULL AND "trainer_id" IS NOT NULL)
    ),
    CONSTRAINT "workout_plans_approved_check" CHECK (
        ("status" IN ('APPROVED', 'SUPERSEDED')) = ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
    )
);

CREATE TABLE "workout_plan_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "workout_plan_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workout_plan_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stage_id" UUID NOT NULL,
    -- The week of the plan (1, 2, ...) and the number of the session in that week; both empty in a template.
    "week" INTEGER,
    "number" INTEGER,
    "goal" TEXT,
    "position" INTEGER NOT NULL,
    CONSTRAINT "workout_plan_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_plan_sessions_week_check" CHECK (("week" IS NULL) = ("number" IS NULL))
);

CREATE TABLE "workout_plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "workout_plan_items_pkey" PRIMARY KEY ("id")
);

-- The targets of one set: Strength has weight, reps, rest, RIR, tempo, technique, notes, video; Cardio has time, speed,
-- heart rate, notes. Which apply is the exercise's kind (the service checks it; the ranges are checked here too).
CREATE TABLE "workout_plan_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "set_no" INTEGER NOT NULL,
    "weight" DECIMAL(7,2),
    "reps" INTEGER,
    "rest_seconds" INTEGER,
    "rir" INTEGER,
    "tempo" TEXT,
    "technique" TEXT,
    "video_url" TEXT,
    "duration_minutes" DECIMAL(6,1),
    "speed" DECIMAL(5,1),
    "heart_rate" INTEGER,
    "notes" TEXT,
    CONSTRAINT "workout_plan_sets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_plan_sets_ranges_check" CHECK (
        ("weight" IS NULL OR "weight" BETWEEN 0 AND 1000)
        AND ("reps" IS NULL OR "reps" BETWEEN 1 AND 1000)
        AND ("rest_seconds" IS NULL OR "rest_seconds" BETWEEN 0 AND 3600)
        AND ("rir" IS NULL OR "rir" BETWEEN 0 AND 10)
        AND ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 0.1 AND 600)
        AND ("speed" IS NULL OR "speed" BETWEEN 0 AND 60)
        AND ("heart_rate" IS NULL OR "heart_rate" BETWEEN 30 AND 250)
        AND ("video_url" IS NULL OR "video_url" ~ '^https://')
    )
);

ALTER TABLE "workout_plans"
    ADD CONSTRAINT "workout_plans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_previous_plan_id_fkey" FOREIGN KEY ("previous_plan_id") REFERENCES "workout_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plans_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_plan_stages"
    ADD CONSTRAINT "workout_plan_stages_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "workout_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plan_stages_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "workout_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_plan_sessions"
    ADD CONSTRAINT "workout_plan_sessions_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "workout_plan_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_plan_items"
    ADD CONSTRAINT "workout_plan_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_plan_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_plan_items_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "workout_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_plan_sets"
    ADD CONSTRAINT "workout_plan_sets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "workout_plan_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "workout_plans_kind_status_idx" ON "workout_plans"("kind", "status");
CREATE INDEX "workout_plans_customer_id_idx" ON "workout_plans"("customer_id");
CREATE INDEX "workout_plans_contract_id_idx" ON "workout_plans"("contract_id");
CREATE INDEX "workout_plans_trainer_id_idx" ON "workout_plans"("trainer_id");
CREATE INDEX "workout_plans_branch_id_idx" ON "workout_plans"("branch_id");
CREATE INDEX "workout_plan_stages_plan_id_idx" ON "workout_plan_stages"("plan_id");
CREATE INDEX "workout_plan_sessions_stage_id_idx" ON "workout_plan_sessions"("stage_id");
CREATE INDEX "workout_plan_items_session_id_idx" ON "workout_plan_items"("session_id");
CREATE INDEX "workout_plan_items_exercise_id_idx" ON "workout_plan_items"("exercise_id");
CREATE INDEX "workout_plan_sets_item_id_idx" ON "workout_plan_sets"("item_id");

-- A plan has at most one revision that is still being written or waiting for approval.
CREATE UNIQUE INDEX "workout_plans_one_open_revision" ON "workout_plans"("previous_plan_id")
    WHERE "previous_plan_id" IS NOT NULL AND "status" IN ('DRAFT', 'PENDING');

-- Once a plan has left the draft, nothing under it changes (D-022 for plans): the database refuses it for every role, the
-- way a contract is locked. The service refuses first with a clear error; this is the backstop.
CREATE FUNCTION "workout_plan_parts_lock"() RETURNS trigger AS $$
DECLARE
    j jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    owner uuid;
    current "PlanStatus";
BEGIN
    IF TG_TABLE_NAME = 'workout_plan_stages' THEN
        owner := (j ->> 'plan_id')::uuid;
    ELSIF TG_TABLE_NAME = 'workout_plan_sessions' THEN
        SELECT "plan_id" INTO owner FROM "workout_plan_stages" WHERE "id" = (j ->> 'stage_id')::uuid;
    ELSIF TG_TABLE_NAME = 'workout_plan_items' THEN
        SELECT s."plan_id" INTO owner FROM "workout_plan_sessions" x
            JOIN "workout_plan_stages" s ON s."id" = x."stage_id" WHERE x."id" = (j ->> 'session_id')::uuid;
    ELSE
        SELECT s."plan_id" INTO owner FROM "workout_plan_items" i
            JOIN "workout_plan_sessions" x ON x."id" = i."session_id"
            JOIN "workout_plan_stages" s ON s."id" = x."stage_id" WHERE i."id" = (j ->> 'item_id')::uuid;
    END IF;
    SELECT "status" INTO current FROM "workout_plans" WHERE "id" = owner;
    IF current IS NOT NULL AND current NOT IN ('DRAFT', 'REJECTED') THEN
        RAISE EXCEPTION 'The content of a workout plan that is not a draft cannot be changed' USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "workout_plan_stages_lock" BEFORE INSERT OR UPDATE OR DELETE ON "workout_plan_stages"
    FOR EACH ROW EXECUTE FUNCTION "workout_plan_parts_lock"();
CREATE TRIGGER "workout_plan_sessions_lock" BEFORE INSERT OR UPDATE OR DELETE ON "workout_plan_sessions"
    FOR EACH ROW EXECUTE FUNCTION "workout_plan_parts_lock"();
CREATE TRIGGER "workout_plan_items_lock" BEFORE INSERT OR UPDATE OR DELETE ON "workout_plan_items"
    FOR EACH ROW EXECUTE FUNCTION "workout_plan_parts_lock"();
CREATE TRIGGER "workout_plan_sets_lock" BEFORE INSERT OR UPDATE OR DELETE ON "workout_plan_sets"
    FOR EACH ROW EXECUTE FUNCTION "workout_plan_parts_lock"();

-- The matrix (09_RBAC.md, brief §2): a plan or template waits for the Master (Admin holds the role first, D-049).
INSERT INTO "approval_rules" ("id", "action_type", "required", "overdue_hours", "updated_at")
VALUES (gen_random_uuid(), 'workout.plan', true, 48, CURRENT_TIMESTAMP);
INSERT INTO "approval_rule_roles" ("action_type", "role_id")
SELECT 'workout.plan', "id" FROM "roles" WHERE "code" IN ('MASTER', 'ADMIN');

-- Who writes plans (Admin, the manager, the PT: their own) and who reviews them (Admin, the manager, the Master).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'workout.plan' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'PT');
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'workout.review' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'MASTER');
