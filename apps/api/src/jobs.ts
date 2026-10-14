import { PgBoss } from "pg-boss";
import { env } from "./platform/env.js";
import { remindOverdueApprovals } from "./platform/approvals/approval.engine.js";
import { remindTasks } from "./modules/tasks/task.service.js";
import { lockOverdueSteps, remindDueSteps } from "./modules/leads/checklist.service.js";
import { reclaimLeads } from "./modules/leads/lead-reclaim.service.js";
import { sendDueEmails } from "./modules/mail/mail.service.js";
import { remindLongFreezes } from "./modules/contracts/contract-freeze.service.js";
import { escalateHangingSessions } from "./modules/checkin/checkin.service.js";
import { generateAllSessions } from "./modules/classes/class.service.js";

// Background work (T-045, T-059): pg-boss queues in PostgreSQL, no Redis. The same code
// runs inside the API (RUN_JOBS=true, the default for development) or in the worker
// process (`node dist/worker.js`, with RUN_JOBS=false on the API). pg-boss keeps a cron
// schedule single across processes, so running both never sends a reminder twice; the
// reminders also mark what they sent.

const REMINDERS = "reminders";
const MAIL = "mail";

/** Every reminder that is due: tasks before and after their deadline, overdue approvals, consulting steps, and leads to move on. */
export async function sendReminders(now: Date = new Date()): Promise<void> {
  await remindTasks(now);
  await remindOverdueApprovals(now);
  await remindDueSteps(now);
  // Steps past their deadline and grace period lock as "Không thực hiện" (D-054).
  await lockOverdueSteps(now);
  // Untouched leads move on to the next consultant (D-052).
  await reclaimLeads(now);
  // A contract deactivated for long reminds the managers (D-023).
  await remindLongFreezes(now);
  // A session that still lacks a full check-in after a day is reported to the reviewers (D-071).
  await escalateHangingSessions(now);
  // Class sessions are made ahead, every hour on the hour (A-161).
  if (now.getMinutes() === 0) await generateAllSessions();
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
  // The customer email outbox (D-036, P-6): own queue, so a failing reminder never holds an email back.
  if (!(await boss.getQueue(MAIL))) await boss.createQueue(MAIL);
  await boss.schedule(MAIL, "* * * * *", null, { tz: env.GYM_TIMEZONE });
  await boss.work(MAIL, async () => {
    await sendDueEmails();
  });
  if (env.NODE_ENV === "production" && env.EMAIL_PROVIDER === "log") {
    console.warn(
      JSON.stringify({
        time: new Date().toISOString(),
        level: "warn",
        type: "mail",
        message: "EMAIL_PROVIDER is log: customer emails are recorded as sent but nothing leaves the server",
      }),
    );
  }
  return { stop: () => boss.stop({ graceful: true, timeout: 10_000 }) };
}
