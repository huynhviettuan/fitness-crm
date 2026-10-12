import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getConsultingReport, getLeadAnalysis } from "@/lib/api/reports";
import { ReportFilters, readReportParams } from "../report-filters";
import { LeadAnalysisView } from "./lead-analysis-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leadAnalysis");
  return { title: t("title") };
}

/** The lead analysis (brief §9, D-041; A-092): the cohort by channel, source, need, nationality, and refusal reason. */
export default async function LeadAnalysisPage({ searchParams }: PageProps<"/reports/lead-analysis">) {
  const user = await requirePageUser();
  if (!can(user, "report.leadAnalysis")) return <ForbiddenState />;

  const t = await getTranslations("leadAnalysis");
  const params = await searchParams;
  // The staff choices come from the consulting report, which a user of this report may not have: then none.
  const staff = can(user, "report.consulting")
    ? (await getConsultingReport({})).items.flatMap((row) => (row.consultant ? [row.consultant] : []))
    : [];
  const values = readReportParams(params, user.branches, staff);
  const analysis = await getLeadAnalysis(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.leadAnalysisExport") && (
            <ExportButton path="/api/v1/reports/lead-analysis/export" query={values} />
          )
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <ReportFilters path="/reports/lead-analysis" values={values} branches={user.branches} staff={staff} />
        <LeadAnalysisView analysis={analysis} />
      </div>
    </>
  );
}
