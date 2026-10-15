import { z } from "zod";
import { parseDsn } from "@flow/shared/monitoring";
import { productionIssues, releaseOf } from "./env.production.js";

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    // The web app's public URL: browsers reach the API through it (T-053), so it is both
    // Better Auth's base URL and the only Origin accepted for state changes (T-033).
    BETTER_AUTH_URL: z.url(),
    // A-001
    GYM_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh").refine(isValidTimeZone, "Unknown IANA timezone"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // D-042, T-052: the AES-256-GCM key for ID numbers and health notes; 32 bytes, base64.
    // One per environment, kept out of the repository; losing it loses those fields.
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, "base64").length === 32,
        "FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
      ),
    // T-059: run the background jobs (reminders) inside the API. Production sets it to
    // false and runs the worker process (`node dist/worker.js`) instead.
    RUN_JOBS: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // D-036, T-051: how customer emails go out. "log" only records that one would be sent (development, tests);
    // "resend" sends through Resend and needs the key and a sender on the authenticated domain (SPF, DKIM, DMARC).
    // T-052: where private files are kept. "local" writes to FILE_STORAGE_DIR (development, tests); "r2" uses a
    // Cloudflare R2 bucket (staging, production) and needs its account, keys, and bucket.
    FILE_STORAGE: z.enum(["local", "r2"]).default("local"),
    FILE_STORAGE_DIR: z.string().min(1).default(".data/files"),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
    EMAIL_FROM: z.string().min(3).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    // D-053, D-056: how staff get a push on their phone. "log" only records that one would go out (development, tests);
    // "webpush" sends through the Web Push protocol (the browsers' own push services) signed with the VAPID key pair.
    PUSH_PROVIDER: z.enum(["log", "webpush"]).default("log"),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
    // A mailto: or https: address the push services can reach the operator at.
    VAPID_SUBJECT: z.string().min(1).optional(),
    // M9.4b (A-312): the database backups. The AES-256-GCM key that seals each dump (32 bytes, base64), not the field key:
    // a backup and the key that opens it are never kept together. Without it the worker takes no backup (development).
    BACKUP_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, "base64").length === 32,
        "BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
      )
      .optional(),
    BACKUP_R2_BUCKET: z.string().min(1).optional(),
    // When the worker dumps the database, in the gym's time zone (cron). Infrastructure, not a business value.
    BACKUP_CRON: z.string().min(9).default("0 2 * * *"),
    // M9.4c (A-313): unexpected errors go to this Sentry project (its DSN); unset, nothing is reported.
    SENTRY_DSN: z
      .string()
      .refine((value) => parseDsn(value) !== null, "SENTRY_DSN must be a Sentry DSN (https://key@host/project)")
      .optional(),
    // Shown in Sentry; defaults to NODE_ENV (staging sets "staging").
    SENTRY_ENVIRONMENT: z.string().min(1).max(64).optional(),
    // M10.4: where the answers of a Lead Ads form are read (Meta's Graph API, a fixed version). The E2E run points it at a stub.
    META_GRAPH_URL: z.url().default("https://graph.facebook.com/v21.0"),
  })
  .superRefine((value, ctx) => {
    for (const issue of productionIssues(value))
      ctx.addIssue({ code: "custom", path: [issue.key], message: issue.message });
    if (value.FILE_STORAGE === "r2") {
      for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const) {
        if (!value[key])
          ctx.addIssue({ code: "custom", path: [key], message: `${key} is required with FILE_STORAGE=r2` });
      }
    }
    if (value.PUSH_PROVIDER === "webpush") {
      for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const) {
        if (!value[key])
          ctx.addIssue({ code: "custom", path: [key], message: `${key} is required with PUSH_PROVIDER=webpush` });
      }
    }
    if (value.EMAIL_PROVIDER !== "resend") return;
    for (const key of ["EMAIL_FROM", "RESEND_API_KEY"] as const) {
      if (!value[key])
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required with EMAIL_PROVIDER=resend` });
    }
  });

export const env = envSchema.parse(process.env);

/** The release running, for the health check (M9.4). */
export const release = releaseOf(process.env);

/** The only Origin allowed to change state (T-033). */
export const appOrigin = new URL(env.BETTER_AUTH_URL).origin;
