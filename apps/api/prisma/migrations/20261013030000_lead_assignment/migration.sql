-- M2.7 step 3: weighted lead assignment and the automatic move.

-- D-050: a turn weight per consultant, initially 1, and a switch for receiving leads.
ALTER TABLE "users" ADD COLUMN "lead_weight" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users" ADD COLUMN "receives_leads" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD CONSTRAINT "users_lead_weight_range" CHECK ("lead_weight" BETWEEN 1 AND 20);

-- D-050: the credit each consultant carries in the weighted round-robin of a branch.
CREATE TABLE "lead_turns" (
    "branch_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "lead_turns_pkey" PRIMARY KEY ("branch_id", "user_id")
);
ALTER TABLE "lead_turns" ADD CONSTRAINT "lead_turns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_turns" ADD CONSTRAINT "lead_turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- D-052: how a lead was given, and how long an untouched one waited before it moved on.
CREATE TYPE "LeadAssignmentKind" AS ENUM ('ROUND_ROBIN', 'MANUAL', 'RECLAIM');
ALTER TABLE "lead_assignments" ADD COLUMN "kind" "LeadAssignmentKind" NOT NULL DEFAULT 'ROUND_ROBIN';
ALTER TABLE "lead_assignments" ADD COLUMN "waited_minutes" INTEGER;
UPDATE "lead_assignments" SET "kind" = 'MANUAL' WHERE "assigned_by" IS NOT NULL;
CREATE INDEX "lead_assignments_kind_assigned_at_idx" ON "lead_assignments"("kind", "assigned_at");
