-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "customer_group_note" TEXT,
ADD COLUMN     "customer_group_option_id" UUID,
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT;

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consulting_scripts" (
    "id" UUID NOT NULL,
    "situation_vi" TEXT NOT NULL,
    "situation_en" TEXT NOT NULL,
    "answer_vi" TEXT,
    "answer_en" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "consulting_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_notes_person_id_created_at_idx" ON "lead_notes"("person_id", "created_at");

-- CreateIndex
CREATE INDEX "consulting_scripts_sort_order_idx" ON "consulting_scripts"("sort_order");

-- CreateIndex
CREATE INDEX "customers_created_at_idx" ON "customers"("created_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_customer_group_option_id_fkey" FOREIGN KEY ("customer_group_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A-070: customer groups are an admin list (D-016); only "Khác" until the owner gives the groups.
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-00000000000e', 'customerGroups', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);

-- A-072: the 12 situations of the brief (§4.1), active, answers to be entered on screen.
INSERT INTO "consulting_scripts" ("id", "situation_vi", "situation_en", "sort_order", "updated_at") VALUES
    ('e0000000-0000-4000-8000-000000000001', 'Chào lần đầu', 'First greeting', 1, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000002', 'Hỏi mục tiêu', 'Asking about goals', 2, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000003', 'Khách có cơn đau', 'Customer in pain', 3, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000004', 'Mời Assessment', 'Inviting to an Assessment', 4, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000005', 'Giá Hybrid', 'Hybrid pricing', 5, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000006', 'Giá Therapy', 'Therapy pricing', 6, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000007', 'NKT', 'NKT', 7, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000008', 'Lớp nhóm', 'Group classes', 8, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000009', 'Membership', 'Membership', 9, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000010', 'Thanh toán', 'Payment', 10, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000011', 'Nhắc lịch', 'Appointment reminder', 11, CURRENT_TIMESTAMP),
    ('e0000000-0000-4000-8000-000000000012', 'Kết thúc tư vấn', 'Closing the consultation', 12, CURRENT_TIMESTAMP);

-- 09_RBAC.md (A-072): Admin and Fitness Manager manage the script library.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'script.manage' FROM "roles" WHERE "code" IN ('ADMIN', 'FITNESS_MANAGER');
