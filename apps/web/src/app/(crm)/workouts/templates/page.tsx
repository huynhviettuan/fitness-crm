import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listPlans } from "@/lib/api/workout-plans";
import { NewTemplateButton } from "../new-plan-dialogs";
import { PlansTable } from "../plans/plans-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutPlans");
  return { title: t("templatesTitle") };
}

/** The plan templates (M7.2, brief §7.1): written by the coach, approved by the Master, then copied into customers' plans. */
export default async function TemplatesPage({ searchParams }: PageProps<"/workouts/templates">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutPlans");
  const params = await searchParams;
  const { page, pageSize } = readPaging(params);
  const showInactive = filterValue(params.inactive) === "1";
  const result = await listPlans({ kind: "TEMPLATE", includeInactive: showInactive, page, pageSize });

  return (
    <>
      <PageHeader
        title={t("templatesTitle")}
        description={t("templatesDescription")}
        actions={can(user, "workout.plan") && <NewTemplateButton />}
      />
      <div className="space-y-4">
        <PlansTable plans={result.items} label={t("templatesTitle")} templates />
        <TablePagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          path="/workouts/templates"
          params={params}
        />
      </div>
    </>
  );
}
