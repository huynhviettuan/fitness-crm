-- Reports (brief §9, D-041, A-093): each report and its export is its own permission.
-- Admin and Fitness Manager have all four; a consultant sees the consulting dashboard (of their own
-- leads, by their data scope); Marketing sees the lead analysis (09_RBAC.md).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY[
    'report.consulting', 'report.consultingExport', 'report.leadAnalysis', 'report.leadAnalysisExport'
]) AS "permission"
WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'report.consulting' FROM "roles" WHERE "code" = 'CONSULTING';

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY['report.leadAnalysis', 'report.leadAnalysisExport']) AS "permission"
WHERE "code" = 'MARKETING';
