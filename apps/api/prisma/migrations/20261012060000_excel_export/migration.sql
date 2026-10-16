-- Export to Excel is one permission per list (brief §2, A-077). Admin has all nine; Fitness
-- Manager the six of the modules it works in (09_RBAC.md: not users, history, or the trash).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY[
    'user.export', 'customer.export', 'lead.export', 'contract.export', 'payment.export',
    'cash.export', 'task.export', 'audit.export', 'trash.export'
]) AS "permission"
WHERE "code" = 'ADMIN';

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", "permission"
FROM "roles", unnest(ARRAY[
    'customer.export', 'lead.export', 'contract.export', 'payment.export', 'cash.export', 'task.export'
]) AS "permission"
WHERE "code" = 'FITNESS_MANAGER';
