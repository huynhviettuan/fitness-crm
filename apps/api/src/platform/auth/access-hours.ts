import { TZDate } from "@date-fns/tz";

export type AccessWindow = { weekdays: number[]; startTime: string; endTime: string };

/**
 * D-017: a user with access windows may sign in and work only inside one of them,
 * on the gym's clock (A-001). No windows: any time. Windows are [start, end).
 */
export function isWithinAccessWindows(windows: readonly AccessWindow[], now: Date, timeZone: string): boolean {
  if (windows.length === 0) return true;
  const local = new TZDate(now, timeZone);
  // getDay(): 0 = Sunday; access windows use ISO weekdays, 7 = Sunday.
  const weekday = local.getDay() === 0 ? 7 : local.getDay();
  const time = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
  return windows.some((window) => window.weekdays.includes(weekday) && time >= window.startTime && time < window.endTime);
}
