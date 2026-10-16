import { z } from "zod";
import { instant } from "../validation/index.js";
import { BACKUP_STATES, JOB_STATES, MACHINE_STATES, SYSTEM_JOBS } from "./system.domain.js";

/**
 * What the System status page shows (A-321), to `system.view` only: how the jobs, the backups, the outbox and the check-in
 * machines are doing, and which settings are on. Never a key, an address, a bucket or a DSN: only whether each is set.
 */
export const systemStatusSchema = z
  .object({
    checkedAt: instant,
    /** The deployed commit, or null; Admin only (the public health checks never show it, A-316). */
    release: z.string().nullable(),
    environment: z.string(),
    settings: z.object({
      /** "record": emails are logged, not sent (the trial, A-317). */
      emailDelivery: z.enum(["send", "record"]),
      fileStorage: z.enum(["r2", "local"]),
      errorMonitoring: z.boolean(),
      backups: z.boolean(),
      /** The jobs run inside the API (the free trial) rather than in the worker. */
      jobsInApi: z.boolean(),
    }),
    jobs: z.array(
      z.object({
        name: z.enum(SYSTEM_JOBS),
        state: z.enum(JOB_STATES),
        lastSucceededAt: instant.nullable(),
        lastFailedAt: instant.nullable(),
        /** The last failure's message, scrubbed of personal data and cut short. */
        lastError: z.string().nullable(),
      }),
    ),
    backup: z.object({
      state: z.enum(BACKUP_STATES),
      lastAt: instant.nullable(),
      bytes: z.int().nullable(),
    }),
    emails: z.object({
      queued: z.int(),
      /** Queued for longer than EMAIL_STUCK_AFTER_MINUTES. */
      stuck: z.int(),
      /** Failed for good over the last EMAIL_FAILED_DAYS days. */
      failed: z.int(),
      lastSentAt: instant.nullable(),
    }),
    machines: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        branch: z.string(),
        state: z.enum(MACHINE_STATES),
        lastSeenAt: instant.nullable(),
        clockOff: z.boolean(),
      }),
    ),
    /** How many of the above need a look. */
    attention: z.int(),
  })
  .meta({ id: "SystemStatus" });

export type SystemStatus = z.infer<typeof systemStatusSchema>;
