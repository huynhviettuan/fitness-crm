import { isClockOff } from "@gymcrm/shared/checkin";
import {
  EMAIL_FAILED_DAYS,
  EMAIL_STUCK_AFTER_MINUTES,
  SYSTEM_JOBS,
  backupState,
  jobState,
  machineState,
  type SystemStatus,
} from "@gymcrm/shared/system";
import { LATEST, type BackupRecord } from "../../backup/backup.js";
import type { Actor } from "../auth/session.js";
import { prisma } from "../db/prisma.js";
import { env, release } from "../env.js";
import { backupStorage, type FileStorage } from "../files/file.storage.js";
import { readParameter } from "../parameters/parameter.service.js";
import { assertCan } from "../permissions/assert.js";
import * as repo from "./system.repository.js";

/** The newest backup's time and size from the storage's pointer; unreadable when the storage cannot be reached. */
async function latestBackup(storage: FileStorage): Promise<{ at: Date | null; bytes: number | null } | "unreadable"> {
  try {
    const record = JSON.parse((await storage.get(LATEST)).toString("utf8")) as BackupRecord;
    return { at: new Date(record.createdAt), bytes: record.bytes };
  } catch (error) {
    // No pointer yet is "never"; anything else (keys, network) is "unreadable".
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || /R2 get failed: 404/.test(String(error))) {
      return { at: null, bytes: null };
    }
    return "unreadable";
  }
}

/**
 * The System status page (A-321): what Admin needs to see without reading logs. Nothing secret leaves: settings say only
 * whether they are on, errors are already scrubbed when recorded.
 */
export async function getSystemStatus(
  actor: Actor,
  now: Date = new Date(),
  options: { storage?: FileStorage; backupsOn?: boolean } = {},
): Promise<SystemStatus> {
  assertCan(actor, "system.view");
  const backupsOn = options.backupsOn ?? Boolean(env.BACKUP_ENCRYPTION_KEY);

  const runs = new Map((await repo.listJobRuns()).map((run) => [run.name, run]));
  const jobs = SYSTEM_JOBS.map((name) => {
    const run = runs.get(name) ?? null;
    return {
      name,
      state: jobState(name, run, now, name === "backup" ? backupsOn : true),
      lastSucceededAt: run?.lastSucceededAt ?? null,
      lastFailedAt: run?.lastFailedAt ?? null,
      lastError: run?.lastError ?? null,
    };
  });

  const latest = backupsOn ? await latestBackup(options.storage ?? backupStorage) : null;
  const backup =
    latest === null
      ? { state: "off" as const, lastAt: null, bytes: null }
      : latest === "unreadable"
        ? { state: "unreadable" as const, lastAt: null, bytes: null }
        : { state: backupState(latest.at, now), lastAt: latest.at, bytes: latest.bytes };

  const emails = await repo.emailCounts(
    prisma,
    now,
    new Date(now.getTime() - EMAIL_STUCK_AFTER_MINUTES * 60_000),
    new Date(now.getTime() - EMAIL_FAILED_DAYS * 24 * 3_600_000),
  );

  const tolerance = Number(await readParameter(prisma, "scanClockToleranceSeconds"));
  const machines = (await repo.listMachines()).map((device) => ({
    id: device.id,
    name: device.name,
    branch: device.branch.name,
    state: machineState(device, now),
    lastSeenAt: device.lastSeenAt,
    clockOff: isClockOff(device.clockOffsetSeconds, tolerance),
  }));

  const attention =
    jobs.filter((job) => job.state === "late" || job.state === "failing" || job.state === "never").length +
    (["late", "never", "unreadable"].includes(backup.state) ? 1 : 0) +
    (emails.stuck > 0 ? 1 : 0) +
    (emails.failed > 0 ? 1 : 0) +
    machines.filter((machine) => machine.state === "silent" || machine.state === "never" || machine.clockOff).length;

  return {
    checkedAt: now,
    release,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    settings: {
      emailDelivery: env.EMAIL_PROVIDER === "resend" ? "send" : "record",
      fileStorage: env.FILE_STORAGE,
      errorMonitoring: Boolean(env.SENTRY_DSN),
      backups: backupsOn,
      jobsInApi: env.RUN_JOBS,
    },
    jobs,
    backup,
    emails,
    machines,
    attention,
  };
}
