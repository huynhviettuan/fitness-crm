import { z } from "zod";
import { parseDateOnly } from "@/lib/format";

// Error messages are i18n keys under `validation.*` in messages/*.json.

/** A dd/MM/yyyy calendar date, as UTC midnight. */
export const calendarDate = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .transform((value, ctx) => {
    const date = parseDateOnly(value);
    if (!date) {
      ctx.addIssue({ code: "custom", message: "invalidDate" });
      return z.NEVER;
    }
    return date;
  });

/** A 24-hour wall-clock time, "H:mm" or "HH:mm", normalized to "HH:mm". */
export const timeOfDay = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { error: "invalidTime" })
  .transform((value) => value.padStart(5, "0"));
