import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { env } from "@/lib/env";
import { formatDateOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { listClassSessions, listClasses } from "@/lib/api/classes";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { bookingContext } from "../bookings/booking-context";
import { ClassBoard, type BoardDay } from "./class-board";
import { ClassFormButton } from "./class-form";
import { ClassesTable } from "./classes-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("classes");
  return { title: t("title") };
}

/** The class schedule (M5.5, brief §6.4): the week's classes, and for managers the class definitions. */
export default async function ClassesPage({ searchParams }: PageProps<"/classes">) {
  const user = await requirePageUser();
  if (!can(user, "class.view")) return <ForbiddenState />;

  const t = await getTranslations("classes");
  const locale = await getLocale();
  const params = await searchParams;
  const canManage = can(user, "class.manage");
  const view = params.view === "manage" && canManage ? "manage" : "week";
  const today = calendarDateInTimeZone(env.GYM_TIMEZONE);
  const picked = parseUrlDay(params.date) ?? today;
  const monday = new Date(picked.getTime() - (isoWeekday(picked) - 1) * DAY_MS);
  const permissions = { manage: canManage, enroll: can(user, "class.enroll"), attend: can(user, "class.attend") };

  const tabs = (
    <nav aria-label={t("title")} className="mb-4 flex flex-wrap items-center gap-2">
      <Button variant={view === "week" ? "secondary" : "ghost"} size="sm" asChild>
        <Link href="/classes" aria-current={view === "week" ? "page" : undefined}>
          {t("views.week")}
        </Link>
      </Button>
      {canManage && (
        <Button variant={view === "manage" ? "secondary" : "ghost"} size="sm" asChild>
          <Link href="/classes?view=manage" aria-current={view === "manage" ? "page" : undefined}>
            {t("views.manage")}
          </Link>
        </Button>
      )}
    </nav>
  );

  if (view === "manage") {
    const [classes, context] = await Promise.all([listClasses(), bookingContext(user)]);
    const branchOf = Object.fromEntries(context.branchOf);
    return (
      <>
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={<ClassFormButton trainers={context.trainers} branches={user.branches} branchOf={branchOf} />}
        />
        {tabs}
        <ClassesTable
          classes={classes}
          canManage={canManage}
          trainers={context.trainers}
          branches={user.branches}
          branchOf={branchOf}
        />
      </>
    );
  }

  const sessions = await listClassSessions({ date: formatDateOnly(monday), days: 7 });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const days: BoardDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getTime() + index * DAY_MS);
    const key = urlDay(date);
    return {
      key,
      label: formatDateOnly(date).slice(0, 5),
      sublabel: weekday.format(date),
      today: key === urlDay(today),
      sessions: sessions.filter((session) => dayKeyOf(session.startsAt, env.GYM_TIMEZONE) === key),
    };
  });
  const link = (offset: number) => `/classes?date=${urlDay(new Date(monday.getTime() + offset * DAY_MS))}`;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {tabs}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" asChild>
          <Link href={link(-7)} aria-label={t("previousWeek")}>
            <ChevronLeftIcon />
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/classes">{t("today")}</Link>
        </Button>
        <Button variant="outline" size="icon" asChild>
          <Link href={link(7)} aria-label={t("nextWeek")}>
            <ChevronRightIcon />
          </Link>
        </Button>
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("weekOf", { from: formatDateOnly(monday), to: formatDateOnly(new Date(monday.getTime() + 6 * DAY_MS)) })}
        </h2>
      </div>
      <ClassBoard days={days} permissions={permissions} />
    </>
  );
}

function isoWeekday(day: Date): number {
  return day.getUTCDay() === 0 ? 7 : day.getUTCDay();
}

function urlDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** A yyyy-MM-dd day from the URL, as UTC midnight. */
function parseUrlDay(value: string | string[] | undefined): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || urlDay(date) !== value ? null : date;
}

/** The gym day (yyyy-MM-dd) an instant falls on. */
function dayKeyOf(instant: Date, timeZone: string): string {
  return urlDay(calendarDateInTimeZone(timeZone, instant));
}
