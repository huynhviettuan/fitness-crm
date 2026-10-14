import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getPtRevenue } from "@/lib/api/reports";
import { listReportTrainers, readTrainerParams, TrainerFilters } from "../report-filters";
import { PtRevenueView } from "./pt-revenue-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ptRevenue");
  return { title: t("title") };
}

/** The PT revenue allocation (brief §6.5, D-032, M5.6): a row per PT and contract, with totals per PT. */
export default async function PtRevenuePage({ searchParams }: PageProps<"/reports/pt-revenue">) {
  const user = await requirePageUser();
  if (!can(user, "report.ptRevenue")) return <ForbiddenState />;

  const t = await getTranslations("ptRevenue");
  const trainers = await listReportTrainers();
  const values = readTrainerParams(await searchParams, user.branches, trainers);
  const report = await getPtRevenue(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.ptRevenueExport") && (
            <ExportButton path="/api/v1/reports/pt-revenue/export" query={values} />
          )
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <TrainerFilters path="/reports/pt-revenue" values={values} branches={user.branches} trainers={trainers} />
        <PtRevenueView report={report} />
      </div>
    </>
  );
}
