import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HistoryIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { filterValue } from "@/lib/filters";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { listAuditEvents } from "@/lib/api/history";
import { listUsers } from "@/lib/api/users";
import { AUDIT_ENTITY_TYPES } from "@flow/shared/audit";
import { parseDateOnly } from "@flow/shared/validation";
import { AuditTable } from "./audit-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FR-PLT-008, T-048: search by kind of record, record, user, and day. */
export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const user = await requirePageUser();
  if (!can(user, "audit.view")) return <ForbiddenState />;

  const t = await getTranslations("audit");
  const datePlaceholder = (await getTranslations("finance"))("datePlaceholder");
  const params = await searchParams;
  // Filters that are not valid are ignored rather than refused.
  const entityType = AUDIT_ENTITY_TYPES.find((type) => type === filterValue(params.entity));
  const id = (value: string | undefined) => (value && UUID.test(value) ? value : undefined);
  const day = (value: string | undefined) => (value && parseDateOnly(value) ? value : undefined);
  const entityId = id(filterValue(params.record));
  const actorUserId = id(filterValue(params.actor));
  const from = day(filterValue(params.from));
  const to = day(filterValue(params.to));
  const { page, pageSize } = readPaging(params);
  // The user filter lists accounts only for someone who manages them.
  const [result, users] = await Promise.all([
    listAuditEvents({ entityType, entityId, actorUserId, from, to, page, pageSize }),
    can(user, "user.manage") ? listUsers() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can(user, "audit.export") && (
            <ExportButton path="/api/v1/audit-events/export" query={{ entityType, entityId, actorUserId, from, to }} />
          )
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/admin/audit" label={t("filters")} submitLabel={t("apply")}>
          <FilterSelect
            name="entity"
            label={t("entity")}
            allLabel={t("allEntities")}
            value={entityType}
            options={AUDIT_ENTITY_TYPES.map((type) => ({ value: type, label: t(`entities.${type}`) }))}
          />
          {users.length > 0 && (
            <FilterSelect
              name="actor"
              label={t("actor")}
              allLabel={t("allActors")}
              value={actorUserId}
              options={users.map((account) => ({ value: account.id, label: account.name }))}
            />
          )}
          <FilterInput name="record" label={t("recordId")} value={entityId} description={t("recordIdHint")} />
          <FilterInput name="from" label={t("from")} value={from} placeholder={datePlaceholder} />
          <FilterInput name="to" label={t("to")} value={to} placeholder={datePlaceholder} />
        </FilterPanel>
        <div className="min-w-0">
          <AuditTable
            events={result.items}
            empty={<EmptyState icon={HistoryIcon} title={t("empty")} />}
            footer={
              <TablePagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                path="/admin/audit"
                params={params}
              />
            }
          />
        </div>
      </div>
    </>
  );
}
