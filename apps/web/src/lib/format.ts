import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";

// Display formats are identical in every UI language (docs/23 §5, T-027).
export type AppLocale = "vi" | "en";

const MONEY_LOCALE: Record<AppLocale, string> = { vi: "vi-VN", en: "en-US" };

/** VND, no decimals; separators follow the UI language. */
export function formatMoney(amount: number | string | { toString(): string }, locale: AppLocale): string {
  const value = typeof amount === "number" ? amount : Number(amount.toString());
  return new Intl.NumberFormat(MONEY_LOCALE[locale], {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

/** An instant shown as a date in the gym timezone: dd/MM/yyyy. */
export function formatDate(instant: Date, timeZone: string): string {
  return format(new TZDate(instant, timeZone), "dd/MM/yyyy");
}

/** An instant shown as a 24-hour time in the gym timezone: HH:mm. */
export function formatTime(instant: Date, timeZone: string): string {
  return format(new TZDate(instant, timeZone), "HH:mm");
}

/** An instant shown as date and time in the gym timezone: dd/MM/yyyy HH:mm. */
export function formatDateTime(instant: Date, timeZone: string): string {
  return format(new TZDate(instant, timeZone), "dd/MM/yyyy HH:mm");
}

/** A month of a calendar date (UTC midnight), as MM/yyyy. */
export function formatMonth(date: Date): string {
  return format(new TZDate(date, "UTC"), "MM/yyyy");
}

/**
 * A calendar date with no time of day (e.g. date of birth, stored as a SQL DATE at
 * UTC midnight). Formatted in UTC so it never shifts by a day.
 */
export function formatDateOnly(date: Date): string {
  return format(new TZDate(date, "UTC"), "dd/MM/yyyy");
}
