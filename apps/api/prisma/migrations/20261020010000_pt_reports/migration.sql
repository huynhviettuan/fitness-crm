-- M5.6 (brief §6.5, §9, D-032; A-166 to A-172): the PT revenue allocation report, the booking report, and the first
-- overview dashboard. Each is its own permission (D-017).

-- The commission rate of a service is the share of a session's value that goes to the PT; the report multiplies by it
-- (D-032). It starts at 100%, so a service nobody changed pays the PT the whole allocation (docs/10, OQ-022 interim).
ALTER TABLE "services" ALTER COLUMN "commission_rate" SET DEFAULT 100;
UPDATE "services" SET "commission_rate" = 100 WHERE "commission_rate" = 0;

-- The PT revenue allocation is pay, so it goes to the people who run the gym and the books; the export likewise.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY['report.ptRevenue', 'report.ptRevenueExport']) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'ACCOUNTANT');

-- The booking report is the schedule's, so reception sees it as well.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY['report.bookings', 'report.bookingsExport']) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'RECEPTIONIST');

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'report.overview'
FROM "roles"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'ACCOUNTANT', 'RECEPTIONIST');
