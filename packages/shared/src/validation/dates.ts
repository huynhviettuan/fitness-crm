import { isValid, parse } from "date-fns";
import { TZDate } from "@date-fns/tz";

// Calendar dates travel as UTC midnight (e.g. SQL DATE values); instants are
// converted with the gym timezone (A-001).

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
