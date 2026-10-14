-- M9.2 (brief §11, D-039, FR-IMP-001; A-249 to A-255): the GymMaster import keeps each record's legacy code, so a run that
-- stopped can be run again and a record is never brought over twice; every real run is on record with the cleanup list.
ALTER TABLE "customers" ADD COLUMN "legacy_code" TEXT;
ALTER TABLE "contracts" ADD COLUMN "legacy_code" TEXT;
ALTER TABLE "employees" ADD COLUMN "legacy_code" TEXT;
CREATE UNIQUE INDEX "customers_legacy_code_key" ON "customers"("legacy_code");
CREATE UNIQUE INDEX "contracts_legacy_code_key" ON "contracts"("legacy_code");
CREATE UNIQUE INDEX "employees_legacy_code_key" ON "employees"("legacy_code");

CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "counts" JSONB NOT NULL,
    "cleanup" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
