-- M4.4b (brief §5.3, A-127): printing a contract and updating its note are permissions of their own. Everyone who sees
-- contracts may print them; whoever creates contracts may update their note (also after approval).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'contract.print' FROM "role_permissions" WHERE "permission" = 'contract.view';

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'contract.note' FROM "role_permissions" WHERE "permission" = 'contract.create';
