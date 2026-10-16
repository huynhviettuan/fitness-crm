-- M1 slice 4: audit with before and after values (T-048), and the trash (D-035,
-- T-047). Hand-written: existing audit events, voided payments, and voided cash
-- entries are carried over.

-- ---------------------------------------------------------------------------
-- Audit: before and after become columns. Earlier events kept them in metadata in
-- several shapes; each is moved, and whatever else they held stays as context.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_events" ADD COLUMN "before" JSONB, ADD COLUMN "after" JSONB;

-- { changes: { field: { from, to } } }
UPDATE "audit_events" SET
    "before" = (SELECT jsonb_object_agg(e.key, e.value -> 'from') FROM jsonb_each("metadata" -> 'changes') AS e),
    "after" = (SELECT jsonb_object_agg(e.key, e.value -> 'to') FROM jsonb_each("metadata" -> 'changes') AS e),
    "metadata" = "metadata" - 'changes'
WHERE jsonb_typeof("metadata" -> 'changes') = 'object';

-- { before, after }
UPDATE "audit_events" SET
    "before" = CASE WHEN jsonb_typeof("metadata" -> 'before') = 'object' THEN "metadata" -> 'before' ELSE jsonb_build_object('value', "metadata" -> 'before') END,
    "after" = CASE WHEN jsonb_typeof("metadata" -> 'after') = 'object' THEN "metadata" -> 'after' ELSE jsonb_build_object('value', "metadata" -> 'after') END,
    "metadata" = "metadata" - 'before' - 'after'
WHERE "before" IS NULL AND "after" IS NULL AND ("metadata" ? 'before' OR "metadata" ? 'after');
UPDATE "audit_events" SET "before" = NULL WHERE "before" = '{"value": null}'::jsonb;
UPDATE "audit_events" SET "after" = NULL WHERE "after" = '{"value": null}'::jsonb;

-- Status changes: { from, to }
UPDATE "audit_events" SET
    "before" = jsonb_build_object('status', "metadata" -> 'from'),
    "after" = jsonb_build_object('status', "metadata" -> 'to'),
    "metadata" = "metadata" - 'from' - 'to'
WHERE "before" IS NULL AND "after" IS NULL AND "metadata" ? 'from' AND "metadata" ? 'to';

-- Creates described what was created.
UPDATE "audit_events" SET "after" = "metadata", "metadata" = '{}'::jsonb
WHERE "action" LIKE '%.created' AND "before" IS NULL AND "after" IS NULL;

-- Voids are deletions now (D-035).
UPDATE "audit_events" SET "action" = replace("action", '.voided', '.deleted')
WHERE "action" IN ('payment.voided', 'cash_transaction.voided');

CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events"("actor_user_id");
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- ---------------------------------------------------------------------------
-- Trash
-- ---------------------------------------------------------------------------
CREATE TABLE "trash_entries" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(14,0),
    "snapshot" JSONB NOT NULL,
    "reason_option_id" UUID NOT NULL,
    "reason_note" TEXT,
    "deleted_by" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trash_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trash_entries_entity_type_entity_id_key" ON "trash_entries"("entity_type", "entity_id");
CREATE INDEX "trash_entries_deleted_at_idx" ON "trash_entries"("deleted_at");
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_reason_option_id_fkey" FOREIGN KEY ("reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Payments: voided becomes deleted to the trash.
-- ---------------------------------------------------------------------------
ALTER TABLE "payments"
    ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
    ADD COLUMN "deleted_by" UUID,
    ADD COLUMN "delete_reason_option_id" UUID,
    ADD COLUMN "delete_reason_note" TEXT;
UPDATE "payments" SET
    "deleted_at" = "voided_at",
    "deleted_by" = "voided_by",
    "delete_reason_option_id" = "void_reason_option_id",
    "delete_reason_note" = "void_reason_note"
WHERE "status" = 'VOIDED';

-- The trash keeps each voided payment as the API showed it (the Payment shape).
INSERT INTO "trash_entries" ("id", "entity_type", "entity_id", "branch_id", "title", "amount", "snapshot", "reason_option_id", "reason_note", "deleted_by", "deleted_at")
SELECT
    gen_random_uuid(), 'payment', p."id", p."branch_id",
    c."contract_code" || ' · ' || cu."full_name",
    p."amount",
    jsonb_build_object(
        'id', p."id",
        'amount', p."amount"::bigint,
        'method', jsonb_build_object('id', m."id", 'labelVi', m."label_vi", 'labelEn', m."label_en", 'isOther', m."is_other", 'note', p."method_note"),
        'paidOn', to_char(p."paid_on", 'YYYY-MM-DD') || 'T00:00:00.000Z',
        'createdAt', to_char(p."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdBy', u."name",
        'contract', jsonb_build_object('id', c."id", 'contractCode', c."contract_code", 'packageName', c."package_name"),
        'customer', jsonb_build_object('id', cu."id", 'customerCode', cu."customer_code", 'fullName', cu."full_name")
    ),
    p."delete_reason_option_id", p."delete_reason_note", p."deleted_by", p."deleted_at"
FROM "payments" p
JOIN "contracts" c ON c."id" = p."contract_id"
JOIN "customers" cu ON cu."id" = c."customer_id"
JOIN "options" m ON m."id" = p."method_option_id"
JOIN "users" u ON u."id" = p."created_by"
WHERE p."deleted_at" IS NOT NULL;

ALTER TABLE "payments" DROP CONSTRAINT "payments_void_complete";
ALTER TABLE "payments" DROP CONSTRAINT "payments_voided_by_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_void_reason_option_id_fkey";
DROP INDEX "payments_contract_id_status_idx";
ALTER TABLE "payments"
    DROP COLUMN "status",
    DROP COLUMN "voided_at",
    DROP COLUMN "voided_by",
    DROP COLUMN "void_reason_option_id",
    DROP COLUMN "void_reason_note";
CREATE INDEX "payments_contract_id_idx" ON "payments"("contract_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_delete_reason_option_id_fkey" FOREIGN KEY ("delete_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- D-035: a deleted payment always records when, by whom, and why.
ALTER TABLE "payments" ADD CONSTRAINT "payments_delete_complete" CHECK (
    ("deleted_at" IS NULL) = ("deleted_by" IS NULL) AND ("deleted_at" IS NULL) = ("delete_reason_option_id" IS NULL)
);

-- ---------------------------------------------------------------------------
-- Cash entries: the same.
-- ---------------------------------------------------------------------------
ALTER TABLE "cash_transactions"
    ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
    ADD COLUMN "deleted_by" UUID,
    ADD COLUMN "delete_reason_option_id" UUID,
    ADD COLUMN "delete_reason_note" TEXT;
UPDATE "cash_transactions" SET
    "deleted_at" = "voided_at",
    "deleted_by" = "voided_by",
    "delete_reason_option_id" = "void_reason_option_id",
    "delete_reason_note" = "void_reason_note"
WHERE "status" = 'VOIDED';

-- The CashTransaction shape; the title is the category with its note.
INSERT INTO "trash_entries" ("id", "entity_type", "entity_id", "branch_id", "title", "amount", "snapshot", "reason_option_id", "reason_note", "deleted_by", "deleted_at")
SELECT
    gen_random_uuid(), 'cash_transaction', t."id", t."branch_id",
    k."label_vi" || COALESCE(': ' || t."category_note", ''),
    t."amount",
    jsonb_build_object(
        'id', t."id",
        'branch', jsonb_build_object('id', b."id", 'name', b."name"),
        'type', t."type",
        'category', jsonb_build_object('id', k."id", 'labelVi', k."label_vi", 'labelEn', k."label_en", 'isOther', k."is_other", 'note', t."category_note"),
        'amount', t."amount"::bigint,
        'description', t."description",
        'reference', t."reference",
        'occurredOn', to_char(t."occurred_on", 'YYYY-MM-DD') || 'T00:00:00.000Z',
        'createdAt', to_char(t."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdBy', u."name"
    ),
    t."delete_reason_option_id", t."delete_reason_note", t."deleted_by", t."deleted_at"
FROM "cash_transactions" t
JOIN "branches" b ON b."id" = t."branch_id"
JOIN "options" k ON k."id" = t."category_option_id"
JOIN "users" u ON u."id" = t."created_by"
WHERE t."deleted_at" IS NOT NULL;

ALTER TABLE "cash_transactions" DROP CONSTRAINT "cash_transactions_void_complete";
ALTER TABLE "cash_transactions" DROP CONSTRAINT "cash_transactions_voided_by_fkey";
ALTER TABLE "cash_transactions" DROP CONSTRAINT "cash_transactions_void_reason_option_id_fkey";
ALTER TABLE "cash_transactions"
    DROP COLUMN "status",
    DROP COLUMN "voided_at",
    DROP COLUMN "voided_by",
    DROP COLUMN "void_reason_option_id",
    DROP COLUMN "void_reason_note";
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_delete_reason_option_id_fkey" FOREIGN KEY ("delete_reason_option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_delete_complete" CHECK (
    ("deleted_at" IS NULL) = ("deleted_by" IS NULL) AND ("deleted_at" IS NULL) = ("delete_reason_option_id" IS NULL)
);

DROP TYPE "MoneyRecordStatus";

-- ---------------------------------------------------------------------------
-- Permissions (09_RBAC.md): deleting vouchers is its own permission, and the action
-- history and the trash are Admin's.
-- ---------------------------------------------------------------------------
UPDATE "role_permissions" SET "permission" = 'payment.delete' WHERE "permission" = 'payment.void';
UPDATE "user_permission_overrides" SET "permission" = 'payment.delete' WHERE "permission" = 'payment.void';
-- Whoever could void payments deletes cash entries too (Admin and "Kế toán", A-032).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "role_id", 'cash.delete' FROM "role_permissions" WHERE "permission" = 'payment.delete';
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", p.permission FROM "roles", (VALUES ('audit.view'), ('trash.view')) AS p(permission) WHERE "code" = 'ADMIN';
