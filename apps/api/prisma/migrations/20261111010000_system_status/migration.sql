-- The System status page (A-321): when each background job last started, succeeded and failed, written by the jobs
-- themselves; and the permission to see the page, Admin's.
CREATE TABLE "job_runs" (
    "name" TEXT NOT NULL,
    "last_started_at" TIMESTAMPTZ(3),
    "last_succeeded_at" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("name")
);

INSERT INTO "role_permissions" ("role_id", "permission") SELECT "id", 'system.view' FROM "roles" WHERE "code" = 'ADMIN';
