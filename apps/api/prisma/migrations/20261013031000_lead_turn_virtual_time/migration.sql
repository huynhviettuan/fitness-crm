-- D-050: the weighted round-robin keeps each consultant's virtual time instead of a credit, so
-- the others carry on in order when someone leaves the rotation. Nothing in `lead_turns` is worth keeping.
DELETE FROM "lead_turns";
ALTER TABLE "lead_turns" DROP COLUMN "credit";
ALTER TABLE "lead_turns" ADD COLUMN "vtime" BIGINT NOT NULL DEFAULT 0;
