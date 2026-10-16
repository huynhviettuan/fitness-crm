import "server-only";
import { env } from "@/lib/env";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { formatDateOnly } from "@/lib/format";
import { monthRange } from "@gymcrm/shared/finance";

/** The month in ?month=yyyy-MM, or the gym's current month (A-001). */
export function selectedMonth(param: string | string[] | undefined) {
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const range = (typeof param === "string" && monthRange(param)) || monthRange(thisMonth.toISOString().slice(0, 7))!;
  return {
    ...range,
    thisMonth,
    /** For links: ?month=yyyy-MM. */
    param: range.from.toISOString().slice(0, 7),
    /** For the services: first and last day as dd/MM/yyyy. */
    query: { from: formatDateOnly(range.from), to: formatDateOnly(range.to) },
  };
}
