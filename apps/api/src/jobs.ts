import { PgBoss } from "pg-boss";
import { env } from "./platform/env.js";
import { remindOverdueApprovals } from "./platform/approvals/approval.engine.js";
import { remindTasks } from "./modules/tasks/task.service.js";
import { lockOverdueSteps, remindDueSteps } from "./modules/leads/checklist.service.js";
import { reclaimLeads } from "./modules/leads/lead-reclaim.service.js";
import { sendDueEmails } from "./modules/mail/mail.service.js";
import { sendDueDeliveries } from "./platform/notifications/delivery.service.js";
import { remindLongFreezes } from "./modules/contracts/contract-freeze.service.js";
import { escalateHangingSessions } from "./modules/checkin/checkin.service.js";
import { generateAllSessions } from "./modules/classes/class.service.js";
import { emailContractNotices } from "./modules/contracts/contract-email.js";
import { parseBackupKey, takeBackup } from "./backup/backup.js";
import { backupStorage } from "./platform/files/file.storage.js";
import { reportError } from "./platform/monitoring.js";
import { recordJobRun } from "./platform/system/system.repository.js";
import { scrubText } from "@gymcrm/shared/monitoring";
import type { SystemJob } from "@gymcrm/shared/system";

// Background work (T-045, T-059): pg-boss queues in PostgreSQL, no Redis. The same code
// runs inside the API (RUN_JOBS=true, the default for development) or in the worker
// process (`node dist/worker.js`, with RUN_JOBS=false on the API). pg-boss keeps a cron
// schedule single across processes, so running both never sends a reminder twice; the
// reminders also mark what they sent.

const REMINDERS = "reminders";
const MAIL = "mail";
const BACKUP = "backup";

const log = (level: "info" | "error", fields: Record<string, unknown>) =>
  console[level](JSON.stringify({ time: new Date().toISOString(), level, ...fields }));

/** The daily database backup (M9.4b, A-312), logged either way; a failure is retried and then left for the alert. */
export async function runDailyBackup(key: string): Promise<void> {
  try {
    const record = await takeBackup({
      databaseUrl: env.DATABASE_URL,
      key: parseBackupKey(key),
      storage: backupStorage,
    });
    log("info", { type: "backup", event: "backup.done", key: record.key, bytes: record.bytes });
  } catch (error) {
    log("error", {
      type: "backup",
      event: "backup.failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

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
  // Customers whose contract is ending or running out of sessions are told, once each, if Admin has it on (M6.3).
  if (now.getMinutes() === 0) await emailContractNotices(now);
}

/**
 * A job's work: its start, success or failure recorded for the System status page (A-321), and a failure reported to the
 * monitoring (M9.4c) before pg-boss records and retries it. Recording never stops the job: a failed write is only logged.
 */
export function reported(name: SystemJob, work: () => Promise<void>): () => Promise<void> {
  const record = (event: Parameters<typeof recordJobRun>[1]) =>
    recordJobRun(name, event).catch((error: unknown) =>
      log("error", { type: "jobs", event: "job_run.not_recorded", job: name, error: String(error) }),
    );
  return async () => {
    await record({ started: new Date() });
    try {
      await work();
    } catch (error) {
      reportError(error, { service: "worker", kind: `job:${name}` });
      const message = error instanceof Error ? error.message : String(error);
      await record({ failed: new Date(), error: scrubText(message).slice(0, 300) });
      throw error;
    }
    await record({ succeeded: new Date() });
  };
}

export type Jobs = { stop(): Promise<void> };

export async function startJobs(): Promise<Jobs> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    max: 2,
    application_name: "gymcrm-jobs",
  });
  boss.on("error", (error: unknown) => {
    console.error(
      JSON.stringify({ time: new Date().toISOString(), level: "error", type: "jobs", error: String(error) }),
    );
    reportError(error, { service: "worker", kind: "pg-boss" });
  });
  await boss.start();
  if (!(await boss.getQueue(REMINDERS))) await boss.createQueue(REMINDERS);
  // Every minute, in the gym's time zone.
  await boss.schedule(REMINDERS, "* * * * *", null, { tz: env.GYM_TIMEZONE });
  await boss.work(
    REMINDERS,
    reported(REMINDERS, () => sendReminders()),
  );
  // The customer email outbox (D-036, P-6): own queue, so a failing reminder never holds an email back.
  if (!(await boss.getQueue(MAIL))) await boss.createQueue(MAIL);
  await boss.schedule(MAIL, "* * * * *", null, { tz: env.GYM_TIMEZONE });
  await boss.work(
    MAIL,
    reported(MAIL, async () => {
      await sendDueEmails();
      // Staff get the important notifications by email and on their phone too (D-053, M6.4).
      await sendDueDeliveries();
    }),
  );
  // The daily backup (M9.4b): only where a backup key is set (staging, production). Retried twice, ten minutes apart.
  const backupKey = env.BACKUP_ENCRYPTION_KEY;
  if (backupKey) {
    if (!(await boss.getQueue(BACKUP))) await boss.createQueue(BACKUP, { retryLimit: 2, retryDelay: 600 });
    await boss.schedule(BACKUP, env.BACKUP_CRON, null, { tz: env.GYM_TIMEZONE });
    await boss.work(
      BACKUP,
      reported(BACKUP, () => runDailyBackup(backupKey)),
    );
  }
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
