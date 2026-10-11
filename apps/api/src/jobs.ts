import { PgBoss } from "pg-boss";
import { env } from "./platform/env.js";
import { remindOverdueApprovals } from "./platform/approvals/approval.engine.js";
import { remindTasks } from "./modules/tasks/task.service.js";
import { remindDueSteps } from "./modules/leads/checklist.service.js";

// Background work (T-045, T-059): pg-boss queues in PostgreSQL, no Redis. The same code
// runs inside the API (RUN_JOBS=true, the default for development) or in the worker
// process (`node dist/worker.js`, with RUN_JOBS=false on the API). pg-boss keeps a cron
// schedule single across processes, so running both never sends a reminder twice; the
// reminders also mark what they sent.

const REMINDERS = "reminders";

/** Every reminder that is due: tasks before and after their deadline, overdue approvals, consulting steps. */
export async function sendReminders(now: Date = new Date()): Promise<void> {
  await remindTasks(now);
  await remindOverdueApprovals(now);
  await remindDueSteps(now);
}

export type Jobs = { stop(): Promise<void> };

export async function startJobs(): Promise<Jobs> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    max: 2,
    application_name: "flow-jobs",
  });
  boss.on("error", (error: unknown) =>
    console.error(
      JSON.stringify({ time: new Date().toISOString(), level: "error", type: "jobs", error: String(error) }),
    ),
  );
  await boss.start();
  if (!(await boss.getQueue(REMINDERS))) await boss.createQueue(REMINDERS);
  // Every minute, in the gym's time zone.
  await boss.schedule(REMINDERS, "* * * * *", null, { tz: env.GYM_TIMEZONE });
  await boss.work(REMINDERS, async () => {
    await sendReminders();
  });
  return { stop: () => boss.stop({ graceful: true, timeout: 10_000 }) };
}
