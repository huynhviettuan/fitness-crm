import { z } from "zod";

const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const envSchema = z.object({
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
});

export const env = envSchema.parse(process.env);

/** The only Origin allowed to change state (T-033). */
export const appOrigin = new URL(env.BETTER_AUTH_URL).origin;
