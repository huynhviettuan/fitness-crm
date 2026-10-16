import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getConsultingReport } from "@/lib/api/reports";
import { ReportFilters, readReportParams } from "../report-filters";
import { ConsultingDashboard } from "./consulting-dashboard";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("consultingReport");
  return { title: t("title") };
}

/** The consulting dashboard (brief §9, D-041; A-089 to A-094): per consultant and for the team. */
export default async function ConsultingReportPage({ searchParams }: PageProps<"/reports/consulting">) {
  const user = await requirePageUser();
  if (!can(user, "report.consulting")) return <ForbiddenState />;

  const t = await getTranslations("consultingReport");
  const params = await searchParams;
  // The first look is unfiltered by staff, so the choices come from the people who have leads.
  const everyone = await getConsultingReport({});
  const staff = everyone.items.flatMap((row) => (row.consultant ? [row.consultant] : []));
  const values = readReportParams(params, user.branches, staff);
  const report = await getConsultingReport(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.consultingExport") && (
            <ExportButton path="/api/v1/reports/consulting/export" query={values} />
          )
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <ReportFilters path="/reports/consulting" values={values} branches={user.branches} staff={staff} />
        <ConsultingDashboard report={report} />
      </div>
    </>
  );
}
