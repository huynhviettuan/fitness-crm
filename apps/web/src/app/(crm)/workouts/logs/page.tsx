import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listLogs } from "@/lib/api/workout-logs";
import { LogsTable } from "./logs-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutLogs");
  return { title: t("title") };
}

/** The session logs a PT or a reviewer sees, newest session first (M7.3, brief §7.3). */
export default async function LogsPage({ searchParams }: PageProps<"/workouts/logs">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutLogs");
  const params = await searchParams;
  const { page, pageSize } = readPaging(params);
  const result = await listLogs({ page, pageSize });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="min-w-0 space-y-4">
        <LogsTable logs={result.items} label={t("title")} />
        <TablePagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          path="/workouts/logs"
          params={params}
        />
      </div>
    </>
  );
}
