import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PhoneForwardedIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { filterValue } from "@/lib/filters";
import { getRecare } from "@/lib/api/leads";
import { RECARE_STATUSES } from "@gymcrm/shared/leads";
import { RecareTable } from "./recare-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recare");
  return { title: t("title") };
}

/**
 * "Danh sách tái chăm sóc" (FR-LEAD-007): leads in No response, Refused, or No show by the
 * day to contact them again. Mine by default; the filters are in the URL.
 */
export default async function RecarePage({ searchParams }: PageProps<"/leads/recare">) {
  const user = await requirePageUser();
  if (!can(user, "lead.view")) return <ForbiddenState />;

  const t = await getTranslations("recare");
  const tStatus = await getTranslations("status.lead");
  const params = await searchParams;
  // Not a list filter: here "all" is a scope of its own, so it is read as is.
  const scope = params.scope === "all" ? "all" : "mine";
  const status = RECARE_STATUSES.find((value) => value === filterValue(params.status));
  const overdue = filterValue(params.overdue) === "true";
  const { page, pageSize } = readPaging(params);
  const result = await getRecare({ scope, status, overdue: overdue || undefined, page, pageSize });
  const filtered = Boolean(status || overdue);

  const kept = { status, overdue: overdue ? "true" : undefined };
  const query = (extra: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...extra, ...kept })) if (value) search.set(key, value);
    return search.toString();
  };
  const withQuery = (search: string) => (search ? `/leads/recare?${search}` : "/leads/recare");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/leads/recare" label={t("filters")} submitLabel={t("apply")}>
          {scope === "all" && <input type="hidden" name="scope" value="all" />}
          <FilterSelect
            name="status"
            label={t("fields.status")}
            allLabel={t("all")}
            value={status}
            options={RECARE_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
          />
          <FilterSelect
            name="overdue"
            label={t("overdueFilter")}
            allLabel={t("all")}
            value={overdue ? "true" : undefined}
            options={[{ value: "true", label: t("overdue") }]}
          />
        </FilterPanel>
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <nav aria-label={t("scopes")} className="flex gap-1">
              {(["mine", "all"] as const).map((value) => (
                <Button key={value} asChild size="sm" variant={scope === value ? "secondary" : "ghost"}>
                  <Link
                    href={withQuery(query({ scope: value === "all" ? "all" : undefined }))}
                    aria-current={scope === value ? "page" : undefined}
                  >
                    {t(`scope.${value}`)}
                  </Link>
                </Button>
              ))}
            </nav>
            <p className="text-sm text-muted-foreground" role="status">
              {t("summary", { total: result.total, overdue: result.overdueTotal })}
            </p>
          </div>
          <RecareTable
            rows={result.items}
            empty={
              filtered ? (
                <EmptyState icon={SearchIcon} title={t("noResultsTitle")} description={t("noResultsBody")} />
              ) : (
                <EmptyState icon={PhoneForwardedIcon} title={t("emptyTitle")} description={t("emptyBody")} />
              )
            }
            footer={
              <TablePagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                path="/leads/recare"
                params={params}
              />
            }
          />
        </div>
      </div>
    </>
  );
}
