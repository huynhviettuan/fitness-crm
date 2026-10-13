import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getIncomeExpense } from "@/lib/api/reports";
import { PeriodFilters, readPeriodParams } from "../report-filters";
import { IncomeExpenseView } from "./income-expense-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("incomeExpense");
  return { title: t("title") };
}

/** The income and expense report (brief §9, A-139). */
export default async function IncomeExpensePage({ searchParams }: PageProps<"/reports/income-expense">) {
  const user = await requirePageUser();
  if (!can(user, "report.incomeExpense")) return <ForbiddenState />;

  const t = await getTranslations("incomeExpense");
  const values = readPeriodParams(await searchParams, user.branches);
  const report = await getIncomeExpense(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "report.incomeExpenseExport") && (
            <ExportButton path="/api/v1/reports/income-expense/export" query={values} />
          )
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <PeriodFilters path="/reports/income-expense" values={values} branches={user.branches} />
        <IncomeExpenseView report={report} />
      </div>
    </>
  );
}
