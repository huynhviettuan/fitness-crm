import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClipboardCheckIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { filterValue } from "@/lib/filters";
import { getAuditQueue, getConsultantAudit, getLeadsToCheck } from "@/lib/api/lead-audit";
import { parseDateOnly } from "@flow/shared/validation";
import { ConsultantsTable, LeadsToCheckTable, UnauditedTable } from "./audit-tables";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leadAudit");
  return { title: t("title") };
}

const QUEUE_KEYS = { page: "queuePage", pageSize: "queueSize" };

/** A day typed as dd/MM/yyyy; anything else is ignored rather than refused. */
const day = (param: string | string[] | undefined) => {
  const value = filterValue(param);
  return value && parseDateOnly(value) ? value : undefined;
};

/** The automatic consulting audit (FR-LEAD-011, A-081 to A-085): per consultant, and the leads to check. */
export default async function LeadAuditPage({ searchParams }: PageProps<"/leads/audit">) {
  const user = await requirePageUser();
  if (!can(user, "lead.audit")) return <ForbiddenState />;

  const t = await getTranslations("leadAudit");
  const params = await searchParams;
  const from = day(params.from);
  const to = day(params.to);
  const { page, pageSize } = readPaging(params);
  const consultants = await getConsultantAudit({ from, to });
  const consultantId = consultants.items.find((row) => row.consultant?.id === filterValue(params.consultant))
    ?.consultant?.id;
  const toCheck = await getLeadsToCheck({ from, to, consultantId, page, pageSize });
  // The queue is a work list, the oldest first, which shrinks as leads are graded (A-088); it pages on its own.
  const queuePaging = readPaging(params, QUEUE_KEYS);
  const queue = await getAuditQueue({ from, to, consultantId, ...queuePaging });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/leads/audit" label={t("filters")} submitLabel={t("apply")}>
          <FilterInput name="from" label={t("from")} value={from} placeholder={t("dayHint")} />
          <FilterInput name="to" label={t("to")} value={to} placeholder={t("dayHint")} />
          <FilterSelect
            name="consultant"
            label={t("consultant")}
            allLabel={t("allConsultants")}
            value={consultantId}
            options={consultants.items.flatMap((row) =>
              row.consultant ? [{ value: row.consultant.id, label: row.consultant.name }] : [],
            )}
          />
        </FilterPanel>
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="audit-consultants" className="space-y-3">
            <h2 id="audit-consultants" className="text-lg font-semibold">
              {t("consultants")}
            </h2>
            <ConsultantsTable
              rows={consultants.items}
              team={consultants.team}
              empty={<EmptyState icon={ClipboardCheckIcon} title={t("emptyConsultants")} />}
            />
          </section>
          <section aria-labelledby="audit-to-check" className="space-y-3">
            <div>
              <h2 id="audit-to-check" className="text-lg font-semibold">
                {t("toCheck")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("toCheckHint")}</p>
            </div>
            <LeadsToCheckTable
              rows={toCheck.items}
              empty={<EmptyState icon={ClipboardCheckIcon} title={t("emptyToCheck")} />}
              footer={
                <TablePagination
                  page={toCheck.page}
                  pageSize={toCheck.pageSize}
                  total={toCheck.total}
                  path="/leads/audit"
                  params={params}
                />
              }
            />
          </section>
          <section aria-labelledby="audit-queue" className="space-y-3">
            <div>
              <h2 id="audit-queue" className="text-lg font-semibold">
                {t("queue.title")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("queue.hint", { total: queue.total })}</p>
            </div>
            <UnauditedTable
              rows={queue.items}
              empty={<EmptyState icon={ClipboardCheckIcon} title={t("queue.empty")} />}
              footer={
                <TablePagination
                  page={queue.page}
                  pageSize={queue.pageSize}
                  total={queue.total}
                  path="/leads/audit"
                  params={params}
                  keys={QUEUE_KEYS}
                />
              }
            />
          </section>
        </div>
      </div>
    </>
  );
}
