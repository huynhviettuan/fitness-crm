-- M7.1 (brief §7.1, §7.3, FR-WKO-001, D-033; A-188 to A-191): the workout catalogs (equipment, a tree of body areas,
-- exercises that are Strength or Cardio, and plan stages) and the option lists of the session log (Flag, Action, impact,
-- summary) with the brief's values. Entries are never deleted, only made inactive: plans keep pointing at them.
CREATE TYPE "ExerciseKind" AS ENUM ('STRENGTH', 'CARDIO');

CREATE TABLE "workout_equipment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workout_areas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_areas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_areas_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

CREATE TABLE "workout_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    -- The name in lower case without Vietnamese diacritics, for a search that ignores them.
    "search_name" TEXT NOT NULL,
    "area_id" UUID NOT NULL,
    "equipment_id" UUID,
    "kind" "ExerciseKind" NOT NULL,
    "description" TEXT,
    "video_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_exercises_video_https" CHECK ("video_url" IS NULL OR "video_url" ~ '^https://')
);

CREATE TABLE "workout_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_stages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workout_areas"
    ADD CONSTRAINT "workout_areas_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "workout_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workout_exercises"
    ADD CONSTRAINT "workout_exercises_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "workout_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "workout_exercises_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "workout_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "workout_areas_parent_id_idx" ON "workout_areas"("parent_id");
CREATE INDEX "workout_exercises_area_id_idx" ON "workout_exercises"("area_id");
CREATE INDEX "workout_exercises_equipment_id_idx" ON "workout_exercises"("equipment_id");

-- Codes and names are unique whatever the capitals, so "Squat" and "squat" are one exercise; an area's name only has to
-- be unique among its siblings. (Prisma cannot model these; the service answers a clash as a field error.)
CREATE UNIQUE INDEX "workout_equipment_code_key" ON "workout_equipment"("code");
CREATE UNIQUE INDEX "workout_equipment_name_key" ON "workout_equipment"(lower("name"));
CREATE UNIQUE INDEX "workout_areas_code_key" ON "workout_areas"("code");
CREATE UNIQUE INDEX "workout_areas_name_key"
    ON "workout_areas"(COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
CREATE UNIQUE INDEX "workout_exercises_name_key" ON "workout_exercises"(lower("name"));
CREATE UNIQUE INDEX "workout_stages_name_key" ON "workout_stages"(lower("name"));

INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "code", "updated_at") VALUES
  ('c0000000-0000-4000-8000-000000000401', 'workoutFlags', 'Normal', 'Normal', 1, false, 'NORMAL', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000402', 'workoutFlags', 'Stress', 'Stress', 2, false, 'STRESS', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000403', 'workoutFlags', 'Overload', 'Overload', 3, false, 'OVERLOAD', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000404', 'workoutFlags', 'Pattern', 'Pattern', 4, false, 'PATTERN', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000405', 'workoutFlags', 'Spike/Neuro', 'Spike/Neuro', 5, false, 'SPIKE_NEURO', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000406', 'workoutFlags', 'Khác', 'Other', 0, true, NULL, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000411', 'workoutActions', 'None', 'None', 1, false, 'NONE', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000412', 'workoutActions', 'Theo dõi thêm', 'Monitor further', 2, false, 'MONITOR', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000413', 'workoutActions', 'Giảm tải', 'Reduce load', 3, false, 'REDUCE', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000414', 'workoutActions', 'Tăng tải', 'Increase load', 4, false, 'INCREASE', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000415', 'workoutActions', 'Đổi bài', 'Swap exercise', 5, false, 'SWAP', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000416', 'workoutActions', 'Dừng + Escalation', 'Stop + Escalation', 6, false, 'STOP_ESCALATION', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000417', 'workoutActions', 'Khác', 'Other', 0, true, NULL, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000421', 'sessionImpacts', 'Thấp', 'Low', 1, false, 'LOW', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000422', 'sessionImpacts', 'Trung bình', 'Medium', 2, false, 'MEDIUM', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000423', 'sessionImpacts', 'Cao', 'High', 3, false, 'HIGH', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000424', 'sessionImpacts', 'Không ảnh hưởng', 'No impact', 4, false, 'NONE', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000425', 'sessionImpacts', 'Khác', 'Other', 0, true, NULL, CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000431', 'sessionSummaries', 'Không thay đổi', 'Unchanged', 1, false, 'UNCHANGED', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000432', 'sessionSummaries', 'Tốt hơn', 'Better', 2, false, 'BETTER', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000433', 'sessionSummaries', 'Tệ hơn', 'Worse', 3, false, 'WORSE', CURRENT_TIMESTAMP),
  ('c0000000-0000-4000-8000-000000000434', 'sessionSummaries', 'Khác', 'Other', 0, true, NULL, CURRENT_TIMESTAMP);

-- Everyone who plans or reviews training sees the catalogs; the managers keep them. (PT: own plans only, brief §2.)
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'workout.view' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'MASTER', 'PT');
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'workout.catalog' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');
