-- M7.5 (brief §9, FR-WKO-005; A-212 to A-217): the weekly workout dashboard is for the people who review workouts.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'report.workouts' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER', 'MASTER');
