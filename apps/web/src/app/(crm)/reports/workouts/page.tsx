import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DASHBOARD_KINDS } from "@flow/shared/workouts";
import { parseDateOnly } from "@flow/shared/validation";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { getWorkoutDashboard, getWorkoutDrill } from "@/lib/api/workout-reports";
import { WorkoutDashboardView } from "./workout-dashboard-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutDashboard");
  return { title: t("title") };
}

/** The weekly workout dashboard (brief §9, M7.5): Flag and Action shares, who has a Flag beyond Normal, escalations waiting. */
export default async function WorkoutDashboardPage({ searchParams }: PageProps<"/reports/workouts">) {
  const user = await requirePageUser();
  if (!can(user, "report.workouts")) return <ForbiddenState />;

  const t = await getTranslations("workoutDashboard");
  const params = await searchParams;
  const typed = filterValue(params.week);
  const week = typed && parseDateOnly(typed) ? typed : undefined;
  const branchId = user.branches.find((branch) => branch.id === filterValue(params.branch))?.id;
  const kind = DASHBOARD_KINDS.find((candidate) => candidate === filterValue(params.kind));
  const optionId = filterValue(params.option);
  const { page, pageSize } = readPaging(params);
  const [dashboard, drill] = await Promise.all([
    getWorkoutDashboard({ week, branchId }),
    kind ? getWorkoutDrill({ week, branchId, kind, optionId, page, pageSize }) : null,
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/reports/workouts" label={t("filters")} submitLabel={t("apply")}>
          <FilterInput name="week" label={t("week")} value={week} placeholder={t("weekHint")} />
          {user.branches.length > 1 && (
            <FilterSelect
              name="branch"
              label={t("branch")}
              allLabel={t("allBranches")}
              value={branchId}
              options={user.branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          )}
        </FilterPanel>
        <WorkoutDashboardView
          dashboard={dashboard}
          drill={drill}
          drillKind={kind}
          drillOption={optionId}
          params={params}
          filters={{ week, branch: branchId }}
        />
      </div>
    </>
  );
}
