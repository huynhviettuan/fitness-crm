import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExportButton } from "@/components/export-button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getTaskReport } from "@/lib/api/reports";
import { PeriodFilters, readPeriodParams } from "../report-filters";
import { TaskReportView } from "./task-report-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taskReport");
  return { title: t("title") };
}

/** The tasks report (brief §9, FR-TASK-006, A-045): tasks given, done on time, done late and overdue. */
export default async function TaskReportPage({ searchParams }: PageProps<"/reports/tasks">) {
  const user = await requirePageUser();
  if (!can(user, "report.tasks")) return <ForbiddenState />;

  const t = await getTranslations("taskReport");
  const values = readPeriodParams(await searchParams, user.branches);
  const report = await getTaskReport(values);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={can(user, "report.tasksExport") && <ExportButton path="/api/v1/reports/tasks/export" query={values} />}
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <PeriodFilters path="/reports/tasks" values={values} branches={user.branches} />
        <TaskReportView report={report} />
      </div>
    </>
  );
}
