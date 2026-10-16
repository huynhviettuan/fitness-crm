-- M2.7 step 5: several reminder points per task (D-056).

-- A task may have its own points, minutes before its deadline; none means the shared points of the parameters.
ALTER TABLE "tasks" ADD COLUMN "reminder_minutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Which point has gone out for a task, so each goes out once; a new deadline clears them.
CREATE TABLE "task_reminders" (
    "task_id" UUID NOT NULL,
    "minutes_before" INTEGER NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("task_id", "minutes_before")
);
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The one reminder of before: a task that had it keeps it as the first point (24 hours).
INSERT INTO "task_reminders" ("task_id", "minutes_before", "sent_at")
SELECT "id", 1440, "due_soon_notified_at" FROM "tasks" WHERE "due_soon_notified_at" IS NOT NULL;
ALTER TABLE "tasks" DROP COLUMN "due_soon_notified_at";

-- The single parameter gives way to the list of shared points (initially 24, 3, and 1 hours).
DELETE FROM "system_parameters" WHERE "key" = 'taskDueSoonHours';
