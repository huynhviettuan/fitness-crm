import { z } from "zod";

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
    EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
    EMAIL_FROM: z.string().min(3).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_PROVIDER !== "resend") return;
    for (const key of ["EMAIL_FROM", "RESEND_API_KEY"] as const) {
      if (!value[key])
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required with EMAIL_PROVIDER=resend` });
    }
  });

export const env = envSchema.parse(process.env);

/** The only Origin allowed to change state (T-033). */
export const appOrigin = new URL(env.BETTER_AUTH_URL).origin;
