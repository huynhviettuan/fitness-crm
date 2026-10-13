-- M5.3b (brief §6.6, D-069 to D-072): the machines, the raw scans, and the pairing of a customer's scan and the PT's scan
-- with a booking. The CRM keeps only the machine's user code, never a fingerprint or a face image.
ALTER TABLE "customers" ADD COLUMN "machine_user_code" TEXT;
ALTER TABLE "employees" ADD COLUMN "machine_user_code" TEXT;
CREATE UNIQUE INDEX "customers_machine_user_code_key" ON "customers"("machine_user_code");
CREATE UNIQUE INDEX "employees_machine_user_code_key" ON "employees"("machine_user_code");

CREATE TABLE "checkin_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3),
    "clock_offset_seconds" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "checkin_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checkin_devices_key_hash_key" ON "checkin_devices"("key_hash");
ALTER TABLE "checkin_devices"
    ADD CONSTRAINT "checkin_devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "checkin_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "machine_user_code" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject_type" TEXT,
    "customer_id" UUID,
    "employee_id" UUID,
    "result" TEXT NOT NULL,
    "error_code" TEXT,
    "booking_id" UUID,
    CONSTRAINT "checkin_scans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "checkin_scans_result_check" CHECK ("result" IN ('WAITING', 'PAIRED', 'ERROR', 'REPEAT')),
    CONSTRAINT "checkin_scans_subject_check" CHECK ("subject_type" IS NULL OR "subject_type" IN ('CUSTOMER', 'EMPLOYEE'))
);
-- A machine that resends a batch gets the stored answer, not a second scan.
CREATE UNIQUE INDEX "checkin_scans_device_id_machine_user_code_scanned_at_key"
    ON "checkin_scans"("device_id", "machine_user_code", "scanned_at");
CREATE INDEX "checkin_scans_result_scanned_at_idx" ON "checkin_scans"("result", "scanned_at");
ALTER TABLE "checkin_scans"
    ADD CONSTRAINT "checkin_scans_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "checkin_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "checkin_scans_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings"
    ADD COLUMN "customer_scan_id" UUID,
    ADD COLUMN "pt_scan_id" UUID,
    ADD COLUMN "scan_requested_at" TIMESTAMPTZ(3),
    ADD COLUMN "scan_requested_by" UUID,
    ADD COLUMN "hanging_escalated_at" TIMESTAMPTZ(3);
ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_customer_scan_id_fkey" FOREIGN KEY ("customer_scan_id") REFERENCES "checkin_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "bookings_pt_scan_id_fkey" FOREIGN KEY ("pt_scan_id") REFERENCES "checkin_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A scan serves one session only (D-070).
CREATE UNIQUE INDEX "bookings_customer_scan_id_key" ON "bookings"("customer_scan_id");
CREATE UNIQUE INDEX "bookings_pt_scan_id_key" ON "bookings"("pt_scan_id");

-- A session a device confirmed has no person who checked in or completed it.
ALTER TABLE "sessions" ALTER COLUMN "checked_in_by" DROP NOT NULL;

-- Machines are Admin's; reviewing the hanging sessions and the scan errors is Admin's and Fitness Manager's.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'checkin.devices' FROM "roles" WHERE "code" = 'ADMIN';
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission" FROM "roles", unnest(ARRAY['checkin.review', 'report.manualConfirmations']) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');

-- A session's completion facts are recorded together; a device confirmation has no person who completed it.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_completion_complete";
ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_completion_complete"
    CHECK (("completed_at" IS NULL) = ("completed_by" IS NULL) OR ("confirmation_method" = 'DEVICE' AND "completed_at" IS NOT NULL));
