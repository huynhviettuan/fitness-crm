-- M2.7 step 2 (the owner's answers of 12/10/2026): the organization.

-- D-066: an entry of a list can have a number (mã số) that is unique in its list.
ALTER TABLE "options" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "options_list_key_code_key" ON "options"("list_key", "code");

-- D-046: the direct manager of an employee, told when an approval waits too long (D-048).
ALTER TABLE "employees" ADD COLUMN "manager_id" UUID;
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_not_self" CHECK ("manager_id" IS NULL OR "manager_id" <> "id");
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

-- D-066: "Chi tiết nhu cầu" is a coded catalog; the old free text stays as the note written with the choice.
ALTER TABLE "customers" ADD COLUMN "need_detail_option_id" UUID;
ALTER TABLE "customers" ADD CONSTRAINT "customers_need_detail_option_id_fkey" FOREIGN KEY ("need_detail_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at")
VALUES ('c0000000-0000-4000-8000-000000000010', 'needDetails', 'Khác', 'Other', 0, true, CURRENT_TIMESTAMP);

-- D-046: the departments and job titles of the org chart "Cơ cấu tổ chức Flow Group 10/2026 (Ver 2)".
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at") VALUES
    ('c0000000-0000-4000-8000-000000000201', 'departments', 'Ban điều hành', 'Executive board', 1, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000202', 'departments', 'Studio', 'Studio', 2, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000203', 'departments', 'Marketing', 'Marketing', 3, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000204', 'departments', 'Finance', 'Finance', 4, false, CURRENT_TIMESTAMP);
INSERT INTO "options" ("id", "list_key", "label_vi", "label_en", "sort_order", "is_other", "updated_at") VALUES
    ('c0000000-0000-4000-8000-000000000301', 'jobTitles', 'CEO', 'CEO', 1, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000302', 'jobTitles', 'Trợ lý CEO', 'CEO assistant', 2, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000303', 'jobTitles', 'Studio Manager / Master', 'Studio Manager / Master', 3, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000304', 'jobTitles', 'Operation Coordinator', 'Operation Coordinator', 4, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000305', 'jobTitles', 'Client Care', 'Client Care', 5, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000306', 'jobTitles', 'Coach Leader', 'Coach Leader', 6, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000307', 'jobTitles', 'Coach Advance', 'Coach Advance', 7, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000308', 'jobTitles', 'Coach Junior', 'Coach Junior', 8, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000309', 'jobTitles', 'Coach Rookie', 'Coach Rookie', 9, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000030a', 'jobTitles', 'Marketing Manager', 'Marketing Manager', 10, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000030b', 'jobTitles', 'Content / Branding', 'Content / Branding', 11, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000030c', 'jobTitles', 'Content Creator / Ads Performance', 'Content Creator / Ads Performance', 12, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000030d', 'jobTitles', 'Media', 'Media', 13, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000030e', 'jobTitles', 'Growth / Performance', 'Growth / Performance', 14, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-00000000030f', 'jobTitles', 'Content Creator / Branding Flow Fitness', 'Content Creator / Branding Flow Fitness', 15, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000310', 'jobTitles', 'Content Creator / Branding Flow Store', 'Content Creator / Branding Flow Store', 16, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000311', 'jobTitles', 'Media Flow Fitness', 'Media Flow Fitness', 17, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000312', 'jobTitles', 'Media Flow Store', 'Media Flow Store', 18, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000313', 'jobTitles', 'Direct Sale / Online Flow Fitness', 'Direct Sale / Online Flow Fitness', 19, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000314', 'jobTitles', 'Sale Flow Store', 'Sale Flow Store', 20, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000315', 'jobTitles', 'Kế toán trưởng', 'Chief accountant', 21, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000316', 'jobTitles', 'Kế toán Flow Fitness', 'Accountant Flow Fitness', 22, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000317', 'jobTitles', 'Kế toán Flow Store', 'Accountant Flow Store', 23, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000318', 'jobTitles', 'Dòng tiền Store', 'Store cash flow', 24, false, CURRENT_TIMESTAMP),
    ('c0000000-0000-4000-8000-000000000319', 'jobTitles', 'Kho', 'Warehouse', 25, false, CURRENT_TIMESTAMP);
