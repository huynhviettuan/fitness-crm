import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getContractReport } from "@/lib/api/reports";
import { PeriodFilters, readPeriodParams } from "../report-filters";
import { ContractReportView } from "./contract-report-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contractReport");
  return { title: t("title") };
}

/** The contract report (brief §9, A-140). */
export default async function ContractReportPage({ searchParams }: PageProps<"/reports/contracts">) {
  const user = await requirePageUser();
  if (!can(user, "report.contracts")) return <ForbiddenState />;

  const t = await getTranslations("contractReport");
  const values = readPeriodParams(await searchParams, user.branches);
  const report = await getContractReport(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.contractsExport") && <ExportButton path="/api/v1/reports/contracts/export" query={values} />
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <PeriodFilters path="/reports/contracts" values={values} branches={user.branches} />
        <ContractReportView report={report} />
      </div>
    </>
  );
}
