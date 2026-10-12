import { z } from "zod";
import { parseDateOnly } from "./dates.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

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

/** A dd/MM/yyyy calendar date, or empty for none: stored as null. */
export const optionalCalendarDate = z
  .string()
  .trim()
  .or(z.null())
  .transform((value, ctx) => {
    if (value === null || value === "") return null;
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
