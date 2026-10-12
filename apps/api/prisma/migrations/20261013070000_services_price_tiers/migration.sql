-- M4.1 (D-021, brief §5.1): services, their price tiers in versions, and quick-pick counts.

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('PT', 'CLASS', 'MEMBER');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "allowed_from" TEXT,
    "allowed_to" TEXT,
    "commission_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "max_members" INTEGER,
    "max_per_week" INTEGER,
    "max_per_day" INTEGER,
    "active_from" DATE,
    "active_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_branches" (
    "service_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "service_branches_pkey" PRIMARY KEY ("service_id","branch_id")
);

-- CreateTable
CREATE TABLE "price_tier_versions" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_tier_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "min_sessions" INTEGER NOT NULL,
    "max_sessions" INTEGER,
    "unit_price" DECIMAL(14,0) NOT NULL,
    "validity_months" INTEGER NOT NULL,
    "validity_days" INTEGER NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_packages" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "sessions" INTEGER NOT NULL,

    CONSTRAINT "quick_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE INDEX "service_branches_branch_id_idx" ON "service_branches"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_tier_versions_service_id_version_key" ON "price_tier_versions"("service_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "price_tier_versions_service_id_effective_from_key" ON "price_tier_versions"("service_id", "effective_from");

-- CreateIndex
CREATE INDEX "price_tiers_version_id_min_sessions_idx" ON "price_tiers"("version_id", "min_sessions");

-- CreateIndex
CREATE UNIQUE INDEX "quick_packages_service_id_sessions_key" ON "quick_packages"("service_id", "sessions");

-- AddForeignKey
ALTER TABLE "service_branches" ADD CONSTRAINT "service_branches_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_branches" ADD CONSTRAINT "service_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier_versions" ADD CONSTRAINT "price_tier_versions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tier_versions" ADD CONSTRAINT "price_tier_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "price_tier_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_packages" ADD CONSTRAINT "quick_packages_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A service's allowed hours are both set or both empty and in order; a group has a member limit.
ALTER TABLE "services"
  ADD CONSTRAINT "services_allowed_hours_check" CHECK (
    ("allowed_from" IS NULL AND "allowed_to" IS NULL)
    OR ("allowed_from" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "allowed_to" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "allowed_to" > "allowed_from")
  ),
  ADD CONSTRAINT "services_group_check" CHECK (NOT "is_group" OR "max_members" >= 2),
  ADD CONSTRAINT "services_limits_check" CHECK (
    ("max_members" IS NULL OR "max_members" >= 2) AND ("max_per_week" IS NULL OR "max_per_week" >= 1) AND ("max_per_day" IS NULL OR "max_per_day" >= 1)
  ),
  ADD CONSTRAINT "services_commission_check" CHECK ("commission_rate" BETWEEN 0 AND 100),
  ADD CONSTRAINT "services_validity_check" CHECK ("active_from" IS NULL OR "active_to" IS NULL OR "active_to" >= "active_from");

-- A tier has a real range, a price, and a validity; the tiers of one version never overlap (gaps are allowed, BR-301).
ALTER TABLE "price_tiers"
  ADD CONSTRAINT "price_tiers_range_check" CHECK ("min_sessions" >= 1 AND ("max_sessions" IS NULL OR "max_sessions" >= "min_sessions")),
  ADD CONSTRAINT "price_tiers_price_check" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "price_tiers_validity_check" CHECK ("validity_months" >= 0 AND "validity_days" >= 0 AND "validity_months" + "validity_days" > 0);
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "price_tiers"
  ADD CONSTRAINT "price_tiers_no_overlap" EXCLUDE USING gist (
    "version_id" WITH =,
    int4range("min_sessions", COALESCE("max_sessions", 1000000), '[]') WITH &&
  );

ALTER TABLE "quick_packages" ADD CONSTRAINT "quick_packages_sessions_check" CHECK ("sessions" >= 1);

-- Everyone who sells or keeps the books reads services and prices (a trainer does not); only Admin edits them (09_RBAC.md).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT DISTINCT "role_id", 'service.view' FROM "role_permissions" WHERE "permission" IN ('contract.create', 'payment.view');
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'service.manage' FROM "roles" WHERE "code" = 'ADMIN';
