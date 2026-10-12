import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Trash2Icon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { filterValue } from "@/lib/filters";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { listTrash } from "@/lib/api/history";
import { TRASH_ENTITY_TYPES } from "@flow/shared/trash";
import { parseDateOnly } from "@flow/shared/validation";
import { TrashTable } from "./trash-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trash");
  return { title: t("title") };
}

/** FR-TRASH-002, D-035: read-only; nothing here restores or purges. */
export default async function TrashPage({ searchParams }: PageProps<"/admin/trash">) {
  const user = await requirePageUser();
  if (!can(user, "trash.view")) return <ForbiddenState />;

  const t = await getTranslations("trash");
  const datePlaceholder = (await getTranslations("finance"))("datePlaceholder");
  const params = await searchParams;
  const entityType = TRASH_ENTITY_TYPES.find((type) => type === filterValue(params.type));
  // A day that is not dd/MM/yyyy is ignored rather than refused.
  const day = (value: string | undefined) => (value && parseDateOnly(value) ? value : undefined);
  const from = day(filterValue(params.from));
  const to = day(filterValue(params.to));
  const { page, pageSize } = readPaging(params);
  const result = await listTrash({ entityType, from, to, page, pageSize });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "trash.export") && <ExportButton path="/api/v1/trash/export" query={{ entityType, from, to }} />
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/admin/trash" label={t("filters")} submitLabel={t("apply")}>
          <FilterSelect
            name="type"
            label={t("type")}
            allLabel={t("allTypes")}
            value={entityType}
            options={TRASH_ENTITY_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) }))}
          />
          <FilterInput name="from" label={t("from")} value={from} placeholder={datePlaceholder} />
          <FilterInput name="to" label={t("to")} value={to} placeholder={datePlaceholder} />
        </FilterPanel>
        <div className="min-w-0">
          <TrashTable
            entries={result.items}
            empty={<EmptyState icon={Trash2Icon} title={t("empty")} />}
            footer={
              <TablePagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                path="/admin/trash"
                params={params}
              />
            }
          />
        </div>
      </div>
    </>
  );
}
