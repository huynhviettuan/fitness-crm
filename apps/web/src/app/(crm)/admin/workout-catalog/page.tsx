import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listAreas, listEquipment, listExercises, listStages } from "@/lib/api/workouts";
import { EXERCISE_KINDS } from "@flow/shared/workouts";
import { AreasPanel, EquipmentPanel, ExercisesPanel, StagesPanel } from "./panels";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

const TABS = ["exercises", "areas", "equipment", "stages"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutCatalog");
  return { title: t("title") };
}

/** The catalogs plans are made from: exercises, body areas, equipment and stages (M7.1, brief §7.1). */
export default async function WorkoutCatalogPage({ searchParams }: PageProps<"/admin/workout-catalog">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutCatalog");
  const params = await searchParams;
  const tab = TABS.find((candidate) => candidate === filterValue(params.tab)) ?? "exercises";
  const showInactive = filterValue(params.inactive) === "1";
  const canEdit = can(user, "workout.catalog");
  const href = (next: (typeof TABS)[number]) =>
    `/admin/workout-catalog?tab=${next}${showInactive ? "&inactive=1" : ""}`;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/admin/workout-catalog?tab=${tab}${showInactive ? "" : "&inactive=1"}`}>
              {showInactive ? t("hideInactive") : t("showInactive")}
            </Link>
          </Button>
        }
      />
      <nav aria-label={t("title")} className="mb-4 flex flex-wrap gap-2">
        {TABS.map((candidate) => (
          <Button
            key={candidate}
            variant={candidate === tab ? "secondary" : "ghost"}
            aria-current={candidate === tab ? "page" : undefined}
            asChild
          >
            <Link href={href(candidate)}>{t(`tabs.${candidate}`)}</Link>
          </Button>
        ))}
      </nav>
      {tab === "equipment" && <EquipmentPanel items={await listEquipment(showInactive)} canEdit={canEdit} />}
      {tab === "areas" && <AreasPanel items={await listAreas(showInactive)} canEdit={canEdit} />}
      {tab === "stages" && <StagesPanel items={await listStages(showInactive)} canEdit={canEdit} />}
      {tab === "exercises" && (await ExercisesTab({ params, showInactive, canEdit }))}
    </>
  );
}

async function ExercisesTab({
  params,
  showInactive,
  canEdit,
}: {
  params: Record<string, string | string[] | undefined>;
  showInactive: boolean;
  canEdit: boolean;
}) {
  const t = await getTranslations("workoutCatalog");
  const [areas, equipment] = await Promise.all([listAreas(), listEquipment()]);
  const areaId = areas.find((area) => area.id === filterValue(params.area))?.id;
  const equipmentId = equipment.find((item) => item.id === filterValue(params.equipment))?.id;
  const kind = EXERCISE_KINDS.find((candidate) => candidate === filterValue(params.kind));
  const q = filterValue(params.q);
  const { page, pageSize } = readPaging(params);
  const result = await listExercises({ q, areaId, equipmentId, kind, includeInactive: showInactive, page, pageSize });

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
      <FilterPanel action="/admin/workout-catalog" label={t("filters")} submitLabel={t("apply")}>
        <input type="hidden" name="tab" value="exercises" />
        {showInactive && <input type="hidden" name="inactive" value="1" />}
        <FilterInput name="q" label={t("search")} value={q} />
        <FilterSelect
          name="area"
          label={t("fields.area")}
          allLabel={t("allAreas")}
          value={areaId}
          options={areas.map((area) => ({ value: area.id, label: area.path }))}
        />
        <FilterSelect
          name="equipment"
          label={t("fields.equipment")}
          allLabel={t("allEquipment")}
          value={equipmentId}
          options={equipment.map((item) => ({ value: item.id, label: item.name }))}
        />
        <FilterSelect
          name="kind"
          label={t("fields.kind")}
          allLabel={t("allKinds")}
          value={kind}
          options={EXERCISE_KINDS.map((value) => ({ value, label: t(`kinds.${value}`) }))}
        />
      </FilterPanel>
      <div className="min-w-0 space-y-4">
        <ExercisesPanel items={result.items} areas={areas} equipment={equipment} canEdit={canEdit} />
        <TablePagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          path="/admin/workout-catalog"
          params={params}
        />
      </div>
    </div>
  );
}
