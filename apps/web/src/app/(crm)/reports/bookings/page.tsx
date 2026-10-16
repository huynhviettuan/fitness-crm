import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { BOOKING_REPORT_TYPES } from "@gymcrm/shared/reports";
import { ExportButton } from "@/components/export-button";
import { FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listSessionStatuses } from "@/lib/api/bookings";
import { getBookingReport } from "@/lib/api/reports";
import { listReportTrainers, readTrainerParams, TrainerFilters } from "../report-filters";
import { BookingReportView } from "./booking-report-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("bookingReport");
  return { title: t("title") };
}

/** The booking report (brief §9, A-171): the PT sessions of a period, filtered by type and status. */
export default async function BookingReportPage({ searchParams }: PageProps<"/reports/bookings">) {
  const user = await requirePageUser();
  if (!can(user, "report.bookings")) return <ForbiddenState />;

  const t = await getTranslations("bookingReport");
  const locale = await getLocale();
  const params = await searchParams;
  const [trainers, statuses] = await Promise.all([listReportTrainers(), listSessionStatuses()]);
  const type = BOOKING_REPORT_TYPES.find((candidate) => candidate === filterValue(params.type));
  const status = statuses.find((candidate) => candidate.code === filterValue(params.status))?.code;
  const values = { ...readTrainerParams(params, user.branches, trainers), type, status };
  const { page, pageSize } = readPaging(params);
  const result = await getBookingReport({ ...values, page, pageSize });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.bookingsExport") && <ExportButton path="/api/v1/reports/bookings/export" query={values} />
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <TrainerFilters path="/reports/bookings" values={values} branches={user.branches} trainers={trainers}>
          <FilterSelect
            name="type"
            label={t("fields.type")}
            allLabel={t("allTypes")}
            value={type}
            options={BOOKING_REPORT_TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
          />
          <FilterSelect
            name="status"
            label={t("fields.status")}
            allLabel={t("allStatuses")}
            value={status}
            options={statuses.map((rule) => ({
              value: rule.code,
              label: locale === "vi" ? rule.labelVi : rule.labelEn,
            }))}
          />
        </TrainerFilters>
        <BookingReportView result={result} params={params} />
      </div>
    </>
  );
}
