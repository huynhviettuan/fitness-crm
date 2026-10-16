-- M5.5 (brief §6.4, D-031, BR-411): the class schedule. A class is a weekly slot (days, a time, a coach, a capacity);
-- its sessions are generated ahead of time; a customer is enrolled on a group-class contract and the attendance marks
-- present (consumes one session of that contract) or absent.
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "coach_id" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,
    -- ISO weekdays, 1 = Monday to 7 = Sunday.
    "weekdays" INTEGER[] NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "classes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classes_capacity_check" CHECK ("capacity" > 0),
    CONSTRAINT "classes_weekdays_check" CHECK (cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
    CONSTRAINT "classes_time_check" CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" > "start_time")
);

CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "coach_id" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "class_sessions_status_check" CHECK ("status" IN ('SCHEDULED', 'CANCELLED')),
    CONSTRAINT "class_sessions_time_check" CHECK ("ends_at" > "starts_at")
);

CREATE TABLE "class_attendances" (
    "id" UUID NOT NULL,
    "class_session_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENROLLED',
    -- Set when the customer is marked present: the sessions used of a contract are derived from these (T-050).
    "consumes" BOOLEAN NOT NULL DEFAULT false,
    "enrolled_by" UUID NOT NULL,
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marked_by" UUID,
    "marked_at" TIMESTAMPTZ(3),
    CONSTRAINT "class_attendances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "class_attendances_status_check" CHECK ("status" IN ('ENROLLED', 'PRESENT', 'ABSENT')),
    CONSTRAINT "class_attendances_consumes_check" CHECK ("consumes" = ("status" = 'PRESENT')),
    CONSTRAINT "class_attendances_marked_check" CHECK (("status" = 'ENROLLED') = ("marked_at" IS NULL AND "marked_by" IS NULL))
);

CREATE UNIQUE INDEX "class_sessions_class_id_starts_at_key" ON "class_sessions"("class_id", "starts_at");
CREATE INDEX "class_sessions_starts_at_idx" ON "class_sessions"("starts_at");
CREATE INDEX "class_sessions_branch_id_starts_at_idx" ON "class_sessions"("branch_id", "starts_at");
CREATE INDEX "class_sessions_coach_id_idx" ON "class_sessions"("coach_id");
CREATE UNIQUE INDEX "class_attendances_class_session_id_customer_id_key" ON "class_attendances"("class_session_id", "customer_id");
CREATE INDEX "class_attendances_contract_id_idx" ON "class_attendances"("contract_id");
CREATE INDEX "class_attendances_customer_id_idx" ON "class_attendances"("customer_id");
CREATE INDEX "classes_branch_id_idx" ON "classes"("branch_id");

ALTER TABLE "classes"
  ADD CONSTRAINT "classes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "classes_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_sessions"
  ADD CONSTRAINT "class_sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "class_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "class_sessions_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "class_attendances"
  ADD CONSTRAINT "class_attendances_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "class_attendances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "class_attendances_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "class_attendances_enrolled_by_fkey" FOREIGN KEY ("enrolled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "class_attendances_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Everyone who sees the PT schedule sees the classes; Admin and Fitness Manager manage them; reception and coaches enroll;
-- Admin, Fitness Manager and coaches mark attendance (a coach only in their own classes, checked in the service).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'class.view' FROM "role_permissions" WHERE "permission" = 'booking.view';
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", p.permission FROM "roles", (VALUES ('class.manage'), ('class.enroll'), ('class.attend')) AS p(permission)
WHERE "roles"."code" IN ('ADMIN', 'FITNESS_MANAGER');
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'class.enroll' FROM "roles" WHERE "code" IN ('RECEPTIONIST', 'PT');
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'class.attend' FROM "roles" WHERE "code" = 'PT';
