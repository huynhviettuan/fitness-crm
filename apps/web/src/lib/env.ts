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
  // Where this server reaches the API (T-041). Browsers reach it through /api/* here (T-053).
  API_URL: z.url(),
  // A-001
  GYM_TIMEZONE: z.string().default("Asia/Ho_Chi_Minh").refine(isValidTimeZone, "Unknown IANA timezone"),
  // Hours the PT calendar shows by default (docs/23 §9). Bookings outside them still show.
  SCHEDULE_START_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  SCHEDULE_END_HOUR: z.coerce.number().int().min(1).max(24).default(22),
});

export const env = envSchema.parse(process.env);
