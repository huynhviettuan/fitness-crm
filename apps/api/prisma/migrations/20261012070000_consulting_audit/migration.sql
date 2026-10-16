-- CreateTable
CREATE TABLE "audit_criteria" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_criteria_key_key" ON "audit_criteria"("key");


-- A-083: the criteria of the automatic audit, all on with weight 1.
INSERT INTO "audit_criteria" ("id", "key", "active", "weight", "updated_at") VALUES
    ('e1000000-0000-4000-8000-000000000001', 'needGroup', true, 1, CURRENT_TIMESTAMP),
    ('e1000000-0000-4000-8000-000000000002', 'phone', true, 1, CURRENT_TIMESTAMP),
    ('e1000000-0000-4000-8000-000000000003', 'refuseReason', true, 1, CURRENT_TIMESTAMP);

-- A-084: Admin and Fitness Manager see the automatic audit.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'lead.audit' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');
