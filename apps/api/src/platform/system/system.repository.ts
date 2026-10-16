import type { SystemJob } from "@gymcrm/shared/system";
import { prisma, type Db } from "../db/prisma.js";

// The rows behind the System status page (A-321).

/** A job's run, recorded by the job itself (jobs.ts): its start, then its success or its failure. */
export async function recordJobRun(
  name: SystemJob,
  event: { started: Date } | { succeeded: Date } | { failed: Date; error: string },
  db: Db = prisma,
): Promise<void> {
  const data =
    "started" in event
      ? { lastStartedAt: event.started }
      : "succeeded" in event
        ? { lastSucceededAt: event.succeeded }
        : { lastFailedAt: event.failed, lastError: event.error };
  await db.jobRun.upsert({ where: { name }, create: { name, ...data }, update: data });
}

export function listJobRuns(db: Db = prisma) {
  return db.jobRun.findMany();
}

export async function emailCounts(db: Db, now: Date, stuckBefore: Date, failedSince: Date) {
  const queued = await db.emailMessage.count({ where: { status: "QUEUED" } });
  const stuck = await db.emailMessage.count({ where: { status: "QUEUED", createdAt: { lt: stuckBefore } } });
  const failed = await db.emailMessage.count({ where: { status: "FAILED", updatedAt: { gte: failedSince } } });
  const last = await db.emailMessage.findFirst({
    where: { status: "SENT", sentAt: { lte: now } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return { queued, stuck, failed, lastSentAt: last?.sentAt ?? null };
}

export function listMachines(db: Db = prisma) {
  return db.checkinDevice.findMany({
    select: {
      id: true,
      name: true,
      active: true,
      lastSeenAt: true,
      clockOffsetSeconds: true,
      branch: { select: { name: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}
