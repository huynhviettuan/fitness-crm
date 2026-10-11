-- M1 slice 6: employees and PT working schedules (brief §8.4, D-030). Trainer
-- records become employees in place: same ids, codes, logins, and bookings. Hand-written
-- so nothing is dropped and re-created.

-- Trainers become employees ---------------------------------------------------------
ALTER TYPE "TrainerStatus" RENAME TO "EmployeeStatus";
ALTER TABLE "trainers" RENAME TO "employees";
ALTER TABLE "employees" RENAME COLUMN "trainer_code" TO "employee_code";
ALTER TABLE "employees" RENAME CONSTRAINT "trainers_pkey" TO "employees_pkey";
ALTER TABLE "employees" RENAME CONSTRAINT "trainers_user_id_fkey" TO "employees_user_id_fkey";
ALTER TABLE "employees" RENAME CONSTRAINT "trainers_branch_id_fkey" TO "employees_branch_id_fkey";
ALTER INDEX "trainers_trainer_code_key" RENAME TO "employees_employee_code_key";
ALTER INDEX "trainers_user_id_key" RENAME TO "employees_user_id_key";
ALTER INDEX "trainers_branch_id_idx" RENAME TO "employees_branch_id_idx";
-- Codes keep counting from where trainer codes stopped; they are never reused (D-038).
ALTER SEQUENCE "trainer_code_seq" RENAME TO "employee_code_seq";

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

ALTER TABLE "employees"
    ADD COLUMN "search_name" TEXT,
    ADD COLUMN "birth_date" DATE,
    ADD COLUMN "gender" "Gender",
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "email" TEXT,
    ADD COLUMN "department_option_id" UUID,
    ADD COLUMN "department_note" TEXT,
    ADD COLUMN "team" TEXT,
    ADD COLUMN "title_option_id" UUID,
    ADD COLUMN "title_note" TEXT,
    ADD COLUMN "is_trainer" BOOLEAN NOT NULL DEFAULT false;

-- Every trainer record so far teaches PT. The search name is the full name lowercased
-- without Vietnamese diacritics, as normalizeForSearch makes it.
UPDATE "employees" SET
    "is_trainer" = true,
    "search_name" = btrim(regexp_replace(translate(lower("full_name"), 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'), '\s+', ' ', 'g'));
ALTER TABLE "employees" ALTER COLUMN "search_name" SET NOT NULL;
CREATE INDEX "employees_search_name_idx" ON "employees"("search_name");

ALTER TABLE "employees" ADD CONSTRAINT "employees_department_option_id_fkey" FOREIGN KEY ("department_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_title_option_id_fkey" FOREIGN KEY ("title_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Working schedules ------------------------------------------------------------------
CREATE TABLE "employee_shifts" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id"),
    -- ISO weekday 1 (Monday) to 7; minutes after midnight, end exclusive.
    CONSTRAINT "employee_shifts_weekday_valid" CHECK ("weekday" BETWEEN 1 AND 7),
    CONSTRAINT "employee_shifts_times_valid" CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute")
);
CREATE INDEX "employee_shifts_employee_id_weekday_idx" ON "employee_shifts"("employee_id", "weekday");
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Shifts of one employee and weekday never overlap (btree_gist is installed for T-014).
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_no_overlap"
  EXCLUDE USING gist (
    "employee_id" WITH =,
    "weekday" WITH =,
    int4range("start_minute", "end_minute", '[)') WITH &&
  );

CREATE TABLE "employee_days_off" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_days_off_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_days_off_employee_id_date_key" ON "employee_days_off"("employee_id", "date");
ALTER TABLE "employee_days_off" ADD CONSTRAINT "employee_days_off_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing trainers stay bookable as before (A-042): every day, the PT calendar's hours
-- (the saved parameters, else 05:00-22:00). Admin narrows them on each schedule.
INSERT INTO "employee_shifts" ("id", "employee_id", "weekday", "start_minute", "end_minute")
SELECT gen_random_uuid(), e."id", d.weekday, h.start_minute, h.end_minute
FROM "employees" e
CROSS JOIN generate_series(1, 7) AS d(weekday)
CROSS JOIN (
    SELECT
        split_part(s.v, ':', 1)::int * 60 + split_part(s.v, ':', 2)::int AS start_minute,
        split_part(f.v, ':', 1)::int * 60 + split_part(f.v, ':', 2)::int AS end_minute
    FROM
        (SELECT COALESCE((SELECT "value" #>> '{}' FROM "system_parameters" WHERE "key" = 'calendarDayStart'), '05:00') AS v) s,
        (SELECT COALESCE((SELECT "value" #>> '{}' FROM "system_parameters" WHERE "key" = 'calendarDayEnd'), '22:00') AS v) f
) h;

-- Configuration ----------------------------------------------------------------------
-- The trainer code prefix becomes the employee code prefix; a saved value is kept.
UPDATE "system_parameters" SET "key" = 'employeeCodePrefix' WHERE "key" = 'trainerCodePrefix';

-- Departments (OQ-024 interim) and job titles are admin lists; only "Khác" to start.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at") VALUES
    ('c0000000-0000-4000-8000-000000000006', 'departments', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000007', 'jobTitles', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);

-- Permissions: trainer.* become employee.*, for roles and per-user overrides alike.
UPDATE "role_permissions" SET "permission" = replace("permission", 'trainer.', 'employee.') WHERE "permission" LIKE 'trainer.%';
UPDATE "user_permission_overrides" SET "permission" = replace("permission", 'trainer.', 'employee.') WHERE "permission" LIKE 'trainer.%';
-- 09_RBAC.md: Master, Receptionist, and Kế toán read trainers only to book, which
-- booking.view now covers; they do not see staff profiles.
DELETE FROM "role_permissions"
WHERE "permission" = 'employee.view' AND "role_id" IN (SELECT "id" FROM "roles" WHERE "code" IN ('MASTER', 'RECEPTIONIST', 'ACCOUNTANT'));
-- Data scope "staff" (D-017): like each role's schedule scope, so a PT sees only their
-- own profile and schedule.
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope")
SELECT "role_id", 'staff', "scope" FROM "role_data_scopes" WHERE "resource" = 'schedule';

-- Action history keeps the records it described, under their new name.
UPDATE "audit_events" SET "entity_type" = 'employee' WHERE "entity_type" = 'trainer';
UPDATE "audit_events" SET "action" = replace("action", 'trainer.', 'employee.') WHERE "action" LIKE 'trainer.%';
