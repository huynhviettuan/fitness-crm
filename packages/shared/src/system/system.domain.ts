// The System status page (A-321): what Admin sees of the machinery behind the gym's work, and when each part needs a look.
// The limits are the infrastructure's, not business values (D-015 concerns what the brief makes configurable): a job that
// runs every minute is late after a few minutes, the nightly backup after a day and a little.

export const SYSTEM_JOBS = ["reminders", "mail", "backup"] as const;
export type SystemJob = (typeof SYSTEM_JOBS)[number];

/** How long after its last success a job counts as late, in minutes. */
export const JOB_LATE_AFTER_MINUTES: Record<SystemJob, number> = {
  reminders: 10,
  mail: 10,
  backup: 26 * 60,
};

export const JOB_STATES = ["ok", "late", "failing", "never", "off"] as const;
export type JobState = (typeof JOB_STATES)[number];

const minutesBetween = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / 60_000;

/**
 * A job's state: off when it does not run here (the backup without its key), never when it has not run yet, failing when
 * its last run failed, late when its last success is older than its limit, else ok.
 */
export function jobState(
  job: SystemJob,
  run: { lastSucceededAt: Date | null; lastFailedAt: Date | null } | null,
  now: Date,
  enabled = true,
): JobState {
  if (!enabled) return "off";
  if (!run || (!run.lastSucceededAt && !run.lastFailedAt)) return "never";
  if (run.lastFailedAt && (!run.lastSucceededAt || run.lastFailedAt > run.lastSucceededAt)) return "failing";
  if (!run.lastSucceededAt || minutesBetween(now, run.lastSucceededAt) > JOB_LATE_AFTER_MINUTES[job]) return "late";
  return "ok";
}

export const BACKUP_STATES = ["ok", "late", "never", "off", "unreadable"] as const;
export type BackupState = (typeof BACKUP_STATES)[number];

/** The newest copy in the backup storage: late after the backup job's limit. */
export function backupState(latest: Date | null, now: Date): Exclude<BackupState, "off" | "unreadable"> {
  if (!latest) return "never";
  return minutesBetween(now, latest) > JOB_LATE_AFTER_MINUTES.backup ? "late" : "ok";
}

/** An email waiting longer than this is stuck: the outbox runs every minute and retries within minutes. */
export const EMAIL_STUCK_AFTER_MINUTES = 30;
/** Failed emails are counted over this many days. */
export const EMAIL_FAILED_DAYS = 7;

/** A check-in machine silent for longer than this needs a look (the gym is open every day). */
export const MACHINE_SILENT_AFTER_HOURS = 24;

export const MACHINE_STATES = ["ok", "silent", "never", "off"] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

export function machineState(device: { active: boolean; lastSeenAt: Date | null }, now: Date): MachineState {
  if (!device.active) return "off";
  if (!device.lastSeenAt) return "never";
  return minutesBetween(now, device.lastSeenAt) > MACHINE_SILENT_AFTER_HOURS * 60 ? "silent" : "ok";
}
