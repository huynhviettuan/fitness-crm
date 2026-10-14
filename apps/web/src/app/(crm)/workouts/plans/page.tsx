import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listPlans } from "@/lib/api/workout-plans";
import { PLAN_STATUSES } from "@flow/shared/workouts";
import { PlansTable } from "./plans-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutPlans");
  return { title: t("title") };
}

/** The customers' workout plans a PT or a reviewer sees (M7.2, brief §7.2). */
export default async function PlansPage({ searchParams }: PageProps<"/workouts/plans">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutPlans");
  const ts = await getTranslations("status.plan");
  const params = await searchParams;
  const status = PLAN_STATUSES.find((candidate) => candidate === filterValue(params.status));
  const q = filterValue(params.q);
  const { page, pageSize } = readPaging(params);
  const result = await listPlans({ kind: "CUSTOMER", status, q, page, pageSize });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/workouts/plans" label={t("filters")} submitLabel={t("apply")}>
          <FilterInput name="q" label={t("search")} value={q} />
          <FilterSelect
            name="status"
            label={t("fields.status")}
            allLabel={t("allStatuses")}
            value={status}
            options={PLAN_STATUSES.map((value) => ({ value, label: ts(value) }))}
          />
        </FilterPanel>
        <div className="min-w-0 space-y-4">
          <PlansTable plans={result.items} label={t("title")} />
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            path="/workouts/plans"
            params={params}
          />
        </div>
      </div>
    </>
  );
}
