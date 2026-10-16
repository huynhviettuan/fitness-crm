import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarOffIcon, UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { formatDateOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { listDayBookings } from "@/lib/api/bookings";
import { getParameters } from "@/lib/api/configuration";
import { getCustomer } from "@/lib/api/customers";
import { listTrainersOfDay } from "@/lib/api/employees";
import { minutesOfDay } from "@gymcrm/shared/parameters";
import { bookingContext } from "../bookings/booking-context";
import { AddBookingButton } from "../bookings/bookings-table";
import type { TrainerOption } from "../bookings/booking-types";
import { CalendarToolbar } from "./calendar-toolbar";
import type { CalendarFilters, GridColumn } from "./calendar-types";
import { TrainerScheduleGrid } from "./schedule-grid";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings");
  return { title: t("calendarTitle") };
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requirePageUser();
  if (!can(user, "booking.view")) return <ForbiddenState />;

  const t = await getTranslations("bookings");
  const locale = await getLocale();
  const params = await searchParams;
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const day = parseUrlDay(params.date) ?? today;
  const view = params.view === "week" ? "week" : "day";
  const context = await bookingContext(user, formatDateOnly(day));
  const header = (actions?: React.ReactNode) => (
    <PageHeader title={t("calendarTitle")} description={t("calendarDescription")} actions={actions} />
  );

  if (context.unlinkedTrainer) {
    return (
      <>
        {header()}
        <EmptyState icon={UserRoundXIcon} title={t("trainerNotLinkedTitle")} description={t("trainerNotLinkedBody")} />
      </>
    );
  }

  const branchId =
    typeof params.branch === "string" && user.branches.some((b) => b.id === params.branch) ? params.branch : undefined;
  // Trainers of the branch filter; a trainer outside it is not offered.
  const trainers = context.trainers.filter((tr) => !branchId || context.branchOf.get(tr.id) === branchId);
  const picked =
    typeof params.trainer === "string" && trainers.some((tr) => tr.id === params.trainer) ? params.trainer : undefined;
  const customer = await customerFilter(params.customer);
  // The week view is one trainer's seven days: the one picked, or else the first.
  const weekTrainer = view === "week" ? (picked ?? trainers[0]?.id) : undefined;
  const trainerId = view === "week" ? weekTrainer : picked;
  const filters: CalendarFilters = { day: urlDay(day), view, trainerId: picked, branchId, customer };

  const first = view === "week" ? mondayOf(day) : day;
  const bookings = (
    await listDayBookings({
      date: formatDateOnly(first),
      days: view === "week" ? 7 : 1,
      trainerId,
      customerId: customer?.id,
      branchId,
    })
  ).filter((b) => b.holdsSlot);
  // Calendar hours are a system parameter (D-030, T-049).
  const parameters = await getParameters();
  const columns =
    view === "week"
      ? await weekColumns(
          trainers.find((tr) => tr.id === weekTrainer),
          first,
          locale,
        )
      : dayColumns(
          scheduleColumns(
            trainers,
            bookings.map((b) => b.trainer),
            picked,
          ),
          day,
          context.workingHours,
        );
  const title =
    view === "week"
      ? t("weekSchedule", { from: formatDateOnly(first), to: formatDateOnly(addDays(first, 6)) })
      : t("schedule", { date: formatDateOnly(day) });

  return (
    <>
      {header(
        context.permissions.manage && context.trainers.length > 0 && (
          <AddBookingButton trainers={context.trainers} preset={{ date: formatDateOnly(day) }} />
        ),
      )}
      <CalendarToolbar filters={filters} today={urlDay(today)} trainers={trainers} branches={user.branches} />
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      {columns.length === 0 ? (
        <EmptyState icon={CalendarOffIcon} title={t("noTrainersTitle")} description={t("noTrainersBody")} />
      ) : (
        <TrainerScheduleGrid
          columns={columns}
          bookings={bookings}
          dayStart={minutesOfDay(parameters.calendarDayStart)}
          dayEnd={minutesOfDay(parameters.calendarDayEnd)}
          permissions={context.permissions}
          trainers={context.trainers}
        />
      )}
    </>
  );
}

/** The customer in the URL, if it is one the user can see. */
async function customerFilter(value: string | string[] | undefined) {
  if (typeof value !== "string" || !UUID.test(value)) return undefined;
  try {
    const customer = await getCustomer(value);
    return { id: customer.id, fullName: customer.fullName };
  } catch {
    return undefined;
  }
}

/**
 * Active trainers, plus any trainer who still has a booking that day after being made
 * inactive, so no booking is hidden.
 */
function scheduleColumns(active: TrainerOption[], withBookings: TrainerOption[], only?: string): TrainerOption[] {
  const columns = new Map(active.map((trainer) => [trainer.id, trainer]));
  for (const trainer of withBookings) columns.set(trainer.id, trainer);
  return [...columns.values()].filter((trainer) => !only || trainer.id === only);
}

function dayColumns(
  trainers: TrainerOption[],
  day: Date,
  workingHours: Map<string, { start: string; end: string }[]>,
): GridColumn[] {
  return trainers.map((trainer) => ({
    key: trainer.id,
    label: trainer.fullName,
    trainerId: trainer.id,
    date: formatDateOnly(day),
    dayKey: urlDay(day),
    workingHours: workingHours.get(trainer.id) ?? [],
  }));
}

/** One trainer's seven days, each with the on-duty hours of that day (D-058). */
async function weekColumns(trainer: TrainerOption | undefined, monday: Date, locale: string): Promise<GridColumn[]> {
  if (!trainer) return [];
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Promise.all(
    Array.from({ length: 7 }, async (_, index) => {
      const date = addDays(monday, index);
      const entry = (await listTrainersOfDay(formatDateOnly(date))).find((e) => e.trainer.id === trainer.id);
      return {
        key: urlDay(date),
        label: formatDateOnly(date).slice(0, 5),
        sublabel: weekday.format(date),
        trainerId: trainer.id,
        date: formatDateOnly(date),
        dayKey: urlDay(date),
        workingHours: entry?.workingHours ?? [],
      };
    }),
  );
}

/** A yyyy-MM-dd day from the URL, as UTC midnight. */
function parseUrlDay(value: string | string[] | undefined): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || urlDay(date) !== value ? null : date;
}

function urlDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The Monday of the week the day falls in; weeks run Monday to Sunday (A-149). */
function mondayOf(day: Date): Date {
  return addDays(day, 1 - (day.getUTCDay() === 0 ? 7 : day.getUTCDay()));
}
