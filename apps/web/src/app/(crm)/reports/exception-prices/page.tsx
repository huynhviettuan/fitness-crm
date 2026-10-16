import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getExceptionPrices } from "@/lib/api/reports";
import { PeriodFilters, readPeriodParams } from "../report-filters";
import { ExceptionPricesView } from "./exception-prices-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("exceptionPrices");
  return { title: t("title") };
}

/** The exception-price report (brief §9, BR-302, A-141). */
export default async function ExceptionPricesPage({ searchParams }: PageProps<"/reports/exception-prices">) {
  const user = await requirePageUser();
  if (!can(user, "report.exceptionPrices")) return <ForbiddenState />;

  const t = await getTranslations("exceptionPrices");
  const values = readPeriodParams(await searchParams, user.branches);
  const report = await getExceptionPrices(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.exceptionPricesExport") && (
            <ExportButton path="/api/v1/reports/exception-prices/export" query={values} />
          )
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <PeriodFilters path="/reports/exception-prices" values={values} branches={user.branches} />
        <ExceptionPricesView report={report} />
      </div>
    </>
  );
}
