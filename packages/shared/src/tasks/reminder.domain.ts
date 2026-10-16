// The reminder points of a task (brief §8.2, D-056): a list of "hours before the deadline", initially
// 24, 3, and 1. Admin sets the shared list; whoever gave the task may set its own. Pure rules.

/** The most points a list holds, and the farthest ahead one reaches (30 days), in minutes. */
export const MAX_REMINDER_POINTS = 10;
export const MAX_REMINDER_MINUTES = 30 * 24 * 60;

const MINUTE_MS = 60_000;

export type ReminderError = "invalidReminders" | "tooManyReminders";

/**
 * Reads "24, 3, 1" or "24; 0.5" (a comma or a semicolon between points, a dot in a decimal) as minutes before the deadline, longest first, with no repeats. Hours may
 * have decimals ("0.5" is half an hour). Returns an error key for anything else; an empty list is the
 * caller's to allow or refuse.
 */
export function parseReminderHours(text: string): { minutes: number[] } | { error: ReminderError } {
  const parts = text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return { minutes: [] };
  const minutes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(part)) return { error: "invalidReminders" };
    const value = Math.round(Number(part) * 60);
    if (value < 1 || value > MAX_REMINDER_MINUTES) return { error: "invalidReminders" };
    minutes.push(value);
  }
  const unique = [...new Set(minutes)].sort((a, b) => b - a);
  if (unique.length < minutes.length) return { error: "invalidReminders" };
  if (unique.length > MAX_REMINDER_POINTS) return { error: "tooManyReminders" };
  return { minutes: unique };
}

/** Minutes back to hours as the people write them: 1440, 180, 30 → "24, 3, 0.5". */
export function formatReminderHours(minutes: readonly number[]): string {
  return minutes.map((value) => String(Number((value / 60).toFixed(2)))).join(", ");
}

/**
 * Which points have come (D-056): those whose time `deadline − point` has passed while the deadline is
 * still ahead and that have not gone out. When several have come at once (a task made close to its
 * deadline, or a worker that was down) only the tightest is told, and all of them are marked, so
 * nobody gets three notices in a minute. Returns the point to tell and every point to mark.
 */
export function dueReminders(
  points: readonly number[],
  sent: ReadonlySet<number>,
  deadline: Date,
  now: Date,
): { tell: number | null; mark: number[] } {
  if (now.getTime() >= deadline.getTime()) return { tell: null, mark: [] };
  const due = points.filter((point) => !sent.has(point) && now.getTime() >= deadline.getTime() - point * MINUTE_MS);
  return { tell: due.length === 0 ? null : Math.min(...due), mark: due };
}
