// Working schedules (brief §8.4, D-030): a weekly pattern of shifts plus days off. A
// PT can be booked only inside their working hours of the day.

export type Shift = { weekday: number; start: string; end: string };
/** Minutes after midnight, end exclusive. */
export type Interval = { start: number; end: number };

/** "05:30" → 330; "24:00" → 1440. */
export function minutesOfTime(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 330 → "05:30"; 1440 → "24:00". */
export function timeOfMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The ISO weekday (1 Monday … 7 Sunday) of a calendar date at UTC midnight. */
export function isoWeekday(date: Date): number {
  return date.getUTCDay() === 0 ? 7 : date.getUTCDay();
}

/** The index of a shift that overlaps an earlier one on the same weekday, or -1. */
export function overlappingShift(shifts: readonly Shift[]): number {
  return shifts.findIndex((shift, index) =>
    shifts
      .slice(0, index)
      .some(
        (other) =>
          other.weekday === shift.weekday &&
          minutesOfTime(shift.start) < minutesOfTime(other.end) &&
          minutesOfTime(other.start) < minutesOfTime(shift.end),
      ),
  );
}

/**
 * The working hours of one weekday, sorted, with touching shifts joined (08:00–12:00
 * and 12:00–14:00 make 08:00–14:00). A day off has none.
 */
export function workingIntervals(shifts: readonly Shift[], weekday: number, dayOff = false): Interval[] {
  if (dayOff) return [];
  const sorted = shifts
    .filter((shift) => shift.weekday === weekday)
    .map((shift) => ({ start: minutesOfTime(shift.start), end: minutesOfTime(shift.end) }))
    .sort((a, b) => a.start - b.start);
  const joined: Interval[] = [];
  for (const interval of sorted) {
    const last = joined.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else joined.push({ ...interval });
  }
  return joined;
}

/** Whether [start, end) lies inside one stretch of working hours. */
export function coversSlot(intervals: readonly Interval[], start: number, end: number): boolean {
  return intervals.some((interval) => interval.start <= start && end <= interval.end);
}
