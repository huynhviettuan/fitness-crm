import { useTimeZone } from "next-intl";
import { formatDate, formatDateOnly, formatDateTime, formatTime } from "@/lib/format";

type DateTimeProps = {
  value: Date | string;
  /**
   * date / time / dateTime: an instant, shown in the gym timezone.
   * dateOnly: a calendar date with no time (e.g. date of birth).
   */
  format?: "date" | "time" | "dateTime" | "dateOnly";
};

/** The only way dates and times are displayed (docs/23 §5). */
export function DateTime({ value, format = "date" }: DateTimeProps) {
  const timeZone = useTimeZone();
  if (!timeZone) throw new Error("The gym timezone is not configured (src/i18n/request.ts).");

  const date = typeof value === "string" ? new Date(value) : value;
  const text = {
    date: () => formatDate(date, timeZone),
    time: () => formatTime(date, timeZone),
    dateTime: () => formatDateTime(date, timeZone),
    dateOnly: () => formatDateOnly(date),
  }[format]();

  return <time dateTime={date.toISOString()}>{text}</time>;
}
