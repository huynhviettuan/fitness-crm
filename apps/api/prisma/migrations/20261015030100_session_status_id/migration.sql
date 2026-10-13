-- The audit trail points at records by UUID; a status is keyed by its code and also has an id for that.
ALTER TABLE "session_statuses" ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "session_statuses_id_key" ON "session_statuses"("id");
