import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listEscalations } from "@/lib/api/workout-escalations";
import { ESCALATION_STATUSES } from "@flow/shared/workouts";
import { EscalationsTable } from "./escalations-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutEscalations");
  return { title: t("title") };
}

/** The stops raised in session logs, the waiting ones first (M7.4, brief §7.4). */
export default async function EscalationsPage({ searchParams }: PageProps<"/workouts/escalations">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutEscalations");
  const params = await searchParams;
  const status = ESCALATION_STATUSES.find((candidate) => candidate === filterValue(params.status));
  const { page, pageSize } = readPaging(params);
  const result = await listEscalations({ status, page, pageSize });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/workouts/escalations" label={t("filters")} submitLabel={t("apply")}>
          <FilterSelect
            name="status"
            label={t("fields.status")}
            allLabel={t("allStatuses")}
            value={status}
            options={ESCALATION_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          />
        </FilterPanel>
        <div className="min-w-0 space-y-4">
          <EscalationsTable escalations={result.items} label={t("title")} />
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            path="/workouts/escalations"
            params={params}
          />
        </div>
      </div>
    </>
  );
}
