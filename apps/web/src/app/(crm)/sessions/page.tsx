import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarCheckIcon, UserRoundXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
import { calendarDateInTimeZone } from "@gymcrm/shared/validation";
import { formatDateOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { listBookings, type BookingQuery } from "@/lib/api/bookings";
import { bookingContext } from "../bookings/booking-context";
import { AddBookingButton, BookingsTable } from "../bookings/bookings-table";
import { BurnShowButton } from "../bookings/burn-show";
import { CompleteDayButton } from "../bookings/complete-day";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

const VIEWS = ["today", "upcoming", "checkedIn", "completed", "noShow", "cancelled"] as const;
type View = (typeof VIEWS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookings");
  return { title: t("sessionsTitle") };
}

/** Session operations (docs/08 Screen 7): one list per view, filtered on the server. */
export default async function SessionsPage({ searchParams }: PageProps<"/sessions">) {
  const user = await requirePageUser();
  if (!can(user, "booking.view")) return <ForbiddenState />;

  const t = await getTranslations("bookings");
  const params = await searchParams;
  const view: View = VIEWS.find((v) => v === params.view) ?? "today";
  const { page, pageSize } = readPaging(params);
  const context = await bookingContext(user);
  const header = (
    <PageHeader
      title={t("sessionsTitle")}
      description={t("sessionsDescription")}
      actions={
        <>
          {context.permissions.complete && (
            <CompleteDayButton today={formatDateOnly(calendarDateInTimeZone(env.GYM_TIMEZONE))} />
          )}
          {context.permissions.burn && context.trainers.length > 0 && <BurnShowButton trainers={context.trainers} />}
          {context.permissions.manage && context.trainers.length > 0 && (
            <AddBookingButton trainers={context.trainers} />
          )}
        </>
      }
    />
  );

  if (context.unlinkedTrainer) {
    return (
      <>
        {header}
        <EmptyState icon={UserRoundXIcon} title={t("trainerNotLinkedTitle")} description={t("trainerNotLinkedBody")} />
      </>
    );
  }

  const result = await listBookings({ ...viewQuery(view), page, pageSize });
  const hrefFor = (target: { view?: View }) => {
    const query = new URLSearchParams();
    const nextView = target.view ?? view;
    if (nextView !== "today") query.set("view", nextView);
    const search = query.toString();
    return search ? `/sessions?${search}` : "/sessions";
  };

  return (
    <>
      {header}
      <nav aria-label={t("sessionsTitle")} className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button key={v} variant={v === view ? "secondary" : "ghost"} size="sm" asChild>
            <Link href={hrefFor({ view: v })} aria-current={v === view ? "page" : undefined}>
              {t(`views.${v}`)}
            </Link>
          </Button>
        ))}
      </nav>
      <BookingsTable
        bookings={result.items}
        permissions={context.permissions}
        trainers={context.trainers}
        label={t(`views.${view}`)}
        empty={<EmptyState icon={CalendarCheckIcon} title={t("emptyTitle")} />}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            path="/sessions"
            params={params}
          />
        }
      />
    </>
  );
}

/** Each view as a booking query; days are gym days (A-001). */
function viewQuery(view: View): BookingQuery {
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  switch (view) {
    case "today":
      return { from: formatDateOnly(today), to: formatDateOnly(today) };
    case "upcoming":
      return { from: formatDateOnly(tomorrow), status: "BOOKED", checkedIn: false };
    case "checkedIn":
      return { status: "BOOKED", checkedIn: true };
    case "completed":
      return { status: "TRAINED", order: "desc" };
    case "noShow":
      return { status: "NO_SHOW", order: "desc" };
    case "cancelled":
      return { status: "CANCELLED", order: "desc" };
  }
}
