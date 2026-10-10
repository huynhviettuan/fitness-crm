import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CalendarOffIcon, UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { formatDateOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isActiveBooking } from "@flow/shared/bookings";
import { listDayBookings } from "@/lib/api/bookings";
import { getParameters } from "@/lib/api/configuration";
import { minutesOfDay } from "@flow/shared/parameters";
import { bookingContext } from "../bookings/booking-context";
import { AddBookingButton } from "../bookings/bookings-table";
import type { TrainerOption } from "../bookings/booking-types";
import { CalendarToolbar } from "./calendar-toolbar";
import { TrainerScheduleGrid } from "./schedule-grid";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings");
  return { title: t("calendarTitle") };
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const user = await requirePageUser();
  if (!can(user, "booking.view")) return <ForbiddenState />;

  const t = await getTranslations("bookings");
  const params = await searchParams;
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const day = parseUrlDay(params.date) ?? today;
  const context = await bookingContext(user);
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

  const trainerId = typeof params.trainer === "string" && context.trainers.some((tr) => tr.id === params.trainer) ? params.trainer : undefined;
  const bookings = (await listDayBookings({ date: formatDateOnly(day), trainerId })).filter((b) => isActiveBooking(b.status));
  // Calendar hours are a system parameter (D-030, T-049).
  const parameters = await getParameters();
  const columns = scheduleColumns(context.trainers, bookings.map((b) => b.trainer), trainerId);

  return (
    <>
      {header(
        context.permissions.manage && context.trainers.length > 0 && (
          <AddBookingButton trainers={context.trainers} preset={{ date: formatDateOnly(day) }} />
        ),
      )}
      <CalendarToolbar day={urlDay(day)} today={urlDay(today)} trainers={context.trainers} trainerId={trainerId} />
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("schedule", { date: formatDateOnly(day) })}</h2>
      {columns.length === 0 ? (
        <EmptyState icon={CalendarOffIcon} title={t("noTrainersTitle")} description={t("noTrainersBody")} />
      ) : (
        <TrainerScheduleGrid
          date={formatDateOnly(day)}
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

/**
 * Active trainers, plus any trainer who still has a booking that day after being made
 * inactive, so no booking is hidden.
 */
function scheduleColumns(active: TrainerOption[], withBookings: TrainerOption[], only?: string): TrainerOption[] {
  const columns = new Map(active.map((trainer) => [trainer.id, trainer]));
  for (const trainer of withBookings) columns.set(trainer.id, trainer);
  return [...columns.values()].filter((trainer) => !only || trainer.id === only);
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
