import "server-only";
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
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  // A-001
  GYM_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh").refine(isValidTimeZone, "Unknown IANA timezone"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Hours the PT calendar shows by default (docs/23 §9). Bookings outside them still show.
  SCHEDULE_START_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  SCHEDULE_END_HOUR: z.coerce.number().int().min(1).max(24).default(22),
});

export const env = envSchema.parse(process.env);
