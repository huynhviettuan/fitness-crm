import type { WorkingHours } from "../bookings/booking-context";

/** One column of the PT grid: a trainer on the day view, a day on the week view (M5.2). */
export type GridColumn = {
  key: string;
  label: string;
  /** A second line under the label, e.g. the weekday on the week view. */
  sublabel?: string;
  trainerId: string;
  /** The gym day of the column, dd/MM/yyyy for the booking form and yyyy-MM-dd to match bookings. */
  date: string;
  dayKey: string;
  /** On-duty hours of the day (D-058): shown, never a limit. */
  workingHours: WorkingHours;
};

export type CalendarView = "day" | "week";

/** What the calendar shows, all of it in the URL. */
export type CalendarFilters = {
  /** The day shown, or any day of the week shown, yyyy-MM-dd. */
  day: string;
  view: CalendarView;
  trainerId?: string;
  branchId?: string;
  customer?: { id: string; fullName: string };
};
