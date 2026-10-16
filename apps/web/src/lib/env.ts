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
});

export const env = envSchema.parse(process.env);
