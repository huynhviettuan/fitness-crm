import { format, isValid, parse } from "date-fns";
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

/**
 * The gym's current calendar day as UTC midnight, comparable with SQL DATE values
 * such as a contract's end date (T-018).
 */
export function calendarDateInTimeZone(timeZone: string, now: Date = new Date()): Date {
  const local = new TZDate(now, timeZone);
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

/**
 * The instant at which a calendar date (UTC midnight, as from parseDateOnly) reaches
 * the wall-clock time "HH:mm" in `timeZone`.
 */
export function instantAt(date: Date, time: string, timeZone: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const local = new TZDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, timeZone);
  return new Date(local.getTime());
}

/** Parses a dd/MM/yyyy calendar date to UTC midnight, or returns null if invalid. */
export function parseDateOnly(value: string): Date | null {
  const trimmed = value.trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return null;
  const parsed = parse(trimmed, "dd/MM/yyyy", new Date(0));
  if (!isValid(parsed)) return null;
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}
