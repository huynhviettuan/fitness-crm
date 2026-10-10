-- M1 slice 2: branches and the permission tree (D-014, D-017, T-046). Hand-written so
-- existing data survives: a default branch and the default roles of 09_RBAC.md are
-- created, every record joins the default branch, and users keep the closest new role.

CREATE TYPE "DataScope" AS ENUM ('ALL', 'OWN');

CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cloned_from_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
ALTER TABLE "roles" ADD CONSTRAINT "roles_cloned_from_id_fkey" FOREIGN KEY ("cloned_from_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "role_data_scopes" (
    "role_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "scope" "DataScope" NOT NULL,
    CONSTRAINT "role_data_scopes_pkey" PRIMARY KEY ("role_id","resource")
);
ALTER TABLE "role_data_scopes" ADD CONSTRAINT "role_data_scopes_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "role_field_masks" (
    "role_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    CONSTRAINT "role_field_masks_pkey" PRIMARY KEY ("role_id","field")
);
ALTER TABLE "role_field_masks" ADD CONSTRAINT "role_field_masks_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The default branch: every existing record belongs to it (D-014).
INSERT INTO "branches" ("id", "name", "updated_at") VALUES ('b0000000-0000-4000-8000-000000000001', 'Chi nhánh chính', CURRENT_TIMESTAMP);

-- Default roles (09_RBAC.md); admin changes them on screen.
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000001', 'ADMIN', 'Quản trị', 'Toàn quyền cấu hình, check-in Đã tập, xóa, thùng rác, mọi báo cáo', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000001', 'customer.view'), ('a0000000-0000-4000-8000-000000000001', 'customer.manage'), ('a0000000-0000-4000-8000-000000000001', 'contract.view'), ('a0000000-0000-4000-8000-000000000001', 'contract.create'), ('a0000000-0000-4000-8000-000000000001', 'contract.approve'), ('a0000000-0000-4000-8000-000000000001', 'contract.cancel'), ('a0000000-0000-4000-8000-000000000001', 'booking.view'), ('a0000000-0000-4000-8000-000000000001', 'booking.manage'), ('a0000000-0000-4000-8000-000000000001', 'session.checkIn'), ('a0000000-0000-4000-8000-000000000001', 'session.complete'), ('a0000000-0000-4000-8000-000000000001', 'trainer.view'), ('a0000000-0000-4000-8000-000000000001', 'trainer.manage'), ('a0000000-0000-4000-8000-000000000001', 'payment.view'), ('a0000000-0000-4000-8000-000000000001', 'payment.record'), ('a0000000-0000-4000-8000-000000000001', 'payment.void'), ('a0000000-0000-4000-8000-000000000001', 'cash.manage'), ('a0000000-0000-4000-8000-000000000001', 'user.manage'), ('a0000000-0000-4000-8000-000000000001', 'role.manage'), ('a0000000-0000-4000-8000-000000000001', 'branch.manage');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000001', 'customers', 'ALL'), ('a0000000-0000-4000-8000-000000000001', 'contracts', 'ALL'), ('a0000000-0000-4000-8000-000000000001', 'schedule', 'ALL'), ('a0000000-0000-4000-8000-000000000001', 'vouchers', 'ALL');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000002', 'FITNESS_MANAGER', 'Fitness Manager', 'Nhận lead mới, phân lại lead, duyệt hợp đồng và giá ngoại lệ', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000002', 'customer.view'), ('a0000000-0000-4000-8000-000000000002', 'customer.manage'), ('a0000000-0000-4000-8000-000000000002', 'contract.view'), ('a0000000-0000-4000-8000-000000000002', 'contract.create'), ('a0000000-0000-4000-8000-000000000002', 'contract.approve'), ('a0000000-0000-4000-8000-000000000002', 'contract.cancel'), ('a0000000-0000-4000-8000-000000000002', 'booking.view'), ('a0000000-0000-4000-8000-000000000002', 'booking.manage'), ('a0000000-0000-4000-8000-000000000002', 'session.checkIn'), ('a0000000-0000-4000-8000-000000000002', 'session.complete'), ('a0000000-0000-4000-8000-000000000002', 'trainer.view'), ('a0000000-0000-4000-8000-000000000002', 'trainer.manage'), ('a0000000-0000-4000-8000-000000000002', 'payment.view'), ('a0000000-0000-4000-8000-000000000002', 'payment.record'), ('a0000000-0000-4000-8000-000000000002', 'cash.manage');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000002', 'customers', 'ALL'), ('a0000000-0000-4000-8000-000000000002', 'contracts', 'ALL'), ('a0000000-0000-4000-8000-000000000002', 'schedule', 'ALL'), ('a0000000-0000-4000-8000-000000000002', 'vouchers', 'ALL');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000003', 'MASTER', 'Master', 'Xem và duyệt giáo án của mọi PT, xử lý escalation', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000003', 'customer.view'), ('a0000000-0000-4000-8000-000000000003', 'contract.view'), ('a0000000-0000-4000-8000-000000000003', 'booking.view'), ('a0000000-0000-4000-8000-000000000003', 'trainer.view');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000003', 'customers', 'ALL'), ('a0000000-0000-4000-8000-000000000003', 'contracts', 'ALL'), ('a0000000-0000-4000-8000-000000000003', 'schedule', 'ALL'), ('a0000000-0000-4000-8000-000000000003', 'vouchers', 'ALL');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000004', 'CONSULTING', 'Tư vấn', 'Chăm sóc lead được giao, tạo hợp đồng chờ duyệt', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000004', 'customer.view'), ('a0000000-0000-4000-8000-000000000004', 'customer.manage'), ('a0000000-0000-4000-8000-000000000004', 'contract.view'), ('a0000000-0000-4000-8000-000000000004', 'contract.create'), ('a0000000-0000-4000-8000-000000000004', 'payment.view'), ('a0000000-0000-4000-8000-000000000004', 'payment.record');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000004', 'customers', 'OWN'), ('a0000000-0000-4000-8000-000000000004', 'contracts', 'OWN'), ('a0000000-0000-4000-8000-000000000004', 'schedule', 'OWN'), ('a0000000-0000-4000-8000-000000000004', 'vouchers', 'OWN');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000005', 'PT', 'PT', 'Đặt lịch, giáo án, nhật ký buổi tập của học viên mình', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000005', 'customer.view'), ('a0000000-0000-4000-8000-000000000005', 'contract.view'), ('a0000000-0000-4000-8000-000000000005', 'booking.view'), ('a0000000-0000-4000-8000-000000000005', 'booking.manage'), ('a0000000-0000-4000-8000-000000000005', 'session.checkIn'), ('a0000000-0000-4000-8000-000000000005', 'session.complete'), ('a0000000-0000-4000-8000-000000000005', 'trainer.view');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000005', 'customers', 'OWN'), ('a0000000-0000-4000-8000-000000000005', 'contracts', 'OWN'), ('a0000000-0000-4000-8000-000000000005', 'schedule', 'OWN'), ('a0000000-0000-4000-8000-000000000005', 'vouchers', 'OWN');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000006', 'RECEPTIONIST', 'Lễ tân', 'Lead vãng lai, Show / No show, hỗ trợ đặt lịch, bổ sung thông tin khách', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000006', 'customer.view'), ('a0000000-0000-4000-8000-000000000006', 'customer.manage'), ('a0000000-0000-4000-8000-000000000006', 'contract.view'), ('a0000000-0000-4000-8000-000000000006', 'booking.view'), ('a0000000-0000-4000-8000-000000000006', 'booking.manage'), ('a0000000-0000-4000-8000-000000000006', 'session.checkIn'), ('a0000000-0000-4000-8000-000000000006', 'trainer.view'), ('a0000000-0000-4000-8000-000000000006', 'payment.view'), ('a0000000-0000-4000-8000-000000000006', 'payment.record');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000006', 'customers', 'ALL'), ('a0000000-0000-4000-8000-000000000006', 'contracts', 'ALL'), ('a0000000-0000-4000-8000-000000000006', 'schedule', 'ALL'), ('a0000000-0000-4000-8000-000000000006', 'vouchers', 'ALL');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000007', 'MARKETING', 'Marketing', 'Báo cáo lead theo kênh và nguồn', CURRENT_TIMESTAMP);
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000007', 'customers', 'ALL'), ('a0000000-0000-4000-8000-000000000007', 'contracts', 'ALL'), ('a0000000-0000-4000-8000-000000000007', 'schedule', 'ALL'), ('a0000000-0000-4000-8000-000000000007', 'vouchers', 'ALL');
INSERT INTO "role_field_masks" ("role_id", "field") VALUES ('a0000000-0000-4000-8000-000000000007', 'customer.phone'), ('a0000000-0000-4000-8000-000000000007', 'customer.email');
INSERT INTO "roles" ("id", "code", "name", "description", "updated_at") VALUES ('a0000000-0000-4000-8000-000000000008', 'ACCOUNTANT', 'Kế toán', 'Vai trò tùy chỉnh cho công việc sổ quỹ', CURRENT_TIMESTAMP);
INSERT INTO "role_permissions" ("role_id", "permission") VALUES ('a0000000-0000-4000-8000-000000000008', 'customer.view'), ('a0000000-0000-4000-8000-000000000008', 'contract.view'), ('a0000000-0000-4000-8000-000000000008', 'booking.view'), ('a0000000-0000-4000-8000-000000000008', 'trainer.view'), ('a0000000-0000-4000-8000-000000000008', 'payment.view'), ('a0000000-0000-4000-8000-000000000008', 'payment.record'), ('a0000000-0000-4000-8000-000000000008', 'payment.void'), ('a0000000-0000-4000-8000-000000000008', 'cash.manage');
INSERT INTO "role_data_scopes" ("role_id", "resource", "scope") VALUES ('a0000000-0000-4000-8000-000000000008', 'customers', 'ALL'), ('a0000000-0000-4000-8000-000000000008', 'contracts', 'ALL'), ('a0000000-0000-4000-8000-000000000008', 'schedule', 'ALL'), ('a0000000-0000-4000-8000-000000000008', 'vouchers', 'ALL');

-- Users: the closest new role (25_BRIEF_V2_GAP_ANALYSIS.md), the default branch, and
-- every branch for admins.
ALTER TABLE "users" ADD COLUMN "role_id" UUID,
ADD COLUMN "all_branches" BOOLEAN NOT NULL DEFAULT false;
UPDATE "users" SET "role_id" = CASE "role"::text
        WHEN 'ADMIN' THEN 'a0000000-0000-4000-8000-000000000001'::uuid
        WHEN 'MANAGER' THEN 'a0000000-0000-4000-8000-000000000002'::uuid
        WHEN 'RECEPTIONIST' THEN 'a0000000-0000-4000-8000-000000000006'::uuid
        WHEN 'TRAINER' THEN 'a0000000-0000-4000-8000-000000000005'::uuid
        WHEN 'ACCOUNTANT' THEN 'a0000000-0000-4000-8000-000000000008'::uuid
    END,
    "all_branches" = ("role"::text = 'ADMIN');
ALTER TABLE "users" ALTER COLUMN "role_id" SET NOT NULL;
ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "UserRole";
CREATE INDEX "users_role_id_idx" ON "users"("role_id");
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "user_branches" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("user_id","branch_id")
);
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "user_branches" ("user_id", "branch_id") SELECT "id", 'b0000000-0000-4000-8000-000000000001' FROM "users";

CREATE TABLE "user_permission_overrides" (
    "user_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("user_id","permission")
);
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_access_windows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "weekdays" INTEGER[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    CONSTRAINT "user_access_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_access_windows_times_check" CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" > "start_time"),
    CONSTRAINT "user_access_windows_weekdays_check" CHECK (cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7])
);
CREATE INDEX "user_access_windows_user_id_idx" ON "user_access_windows"("user_id");
ALTER TABLE "user_access_windows" ADD CONSTRAINT "user_access_windows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "login_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "login_history_user_id_at_idx" ON "login_history"("user_id", "at");
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customers" ADD COLUMN "branch_id" UUID;
UPDATE "customers" SET "branch_id" = 'b0000000-0000-4000-8000-000000000001';
ALTER TABLE "customers" ALTER COLUMN "branch_id" SET NOT NULL;
CREATE INDEX "customers_branch_id_idx" ON "customers"("branch_id");
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" ADD COLUMN "branch_id" UUID;
UPDATE "contracts" SET "branch_id" = 'b0000000-0000-4000-8000-000000000001';
ALTER TABLE "contracts" ALTER COLUMN "branch_id" SET NOT NULL;
CREATE INDEX "contracts_branch_id_idx" ON "contracts"("branch_id");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trainers" ADD COLUMN "branch_id" UUID;
UPDATE "trainers" SET "branch_id" = 'b0000000-0000-4000-8000-000000000001';
ALTER TABLE "trainers" ALTER COLUMN "branch_id" SET NOT NULL;
CREATE INDEX "trainers_branch_id_idx" ON "trainers"("branch_id");
ALTER TABLE "trainers" ADD CONSTRAINT "trainers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD COLUMN "branch_id" UUID;
UPDATE "bookings" SET "branch_id" = 'b0000000-0000-4000-8000-000000000001';
ALTER TABLE "bookings" ALTER COLUMN "branch_id" SET NOT NULL;
CREATE INDEX "bookings_branch_id_idx" ON "bookings"("branch_id");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "branch_id" UUID;
UPDATE "payments" SET "branch_id" = 'b0000000-0000-4000-8000-000000000001';
ALTER TABLE "payments" ALTER COLUMN "branch_id" SET NOT NULL;
CREATE INDEX "payments_branch_id_idx" ON "payments"("branch_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_transactions" ADD COLUMN "branch_id" UUID;
UPDATE "cash_transactions" SET "branch_id" = 'b0000000-0000-4000-8000-000000000001';
ALTER TABLE "cash_transactions" ALTER COLUMN "branch_id" SET NOT NULL;
CREATE INDEX "cash_transactions_branch_id_idx" ON "cash_transactions"("branch_id");
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who created each customer, for data scope "own" (A-029), recovered from the audit log.
ALTER TABLE "customers" ADD COLUMN "created_by" UUID;
UPDATE "customers" c SET "created_by" = a."actor_user_id"
FROM "audit_events" a
WHERE a."entity_type" = 'customer' AND a."action" = 'customer.created' AND a."entity_id" = c."id";
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
