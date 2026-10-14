-- M9.1 (brief §9, FR-TASK-006, A-045): the tasks report is for the people who follow the work of others.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY['report.tasks', 'report.tasksExport']) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');
