import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { KanbanSquareIcon, ListIcon, MegaphoneIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { filterValue } from "@/lib/filters";
import { listOptions } from "@/lib/api/configuration";
import { getLeadBoard, listLeads } from "@/lib/api/leads";
import { LEAD_STATUSES } from "@flow/shared/leads";
import { AddLeadButton } from "./lead-form";
import { LeadsBoard } from "./leads-board";
import { LeadsTable } from "./leads-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leads");
  return { title: t("title") };
}

/** Leads (FR-LEAD-006): the shared list template (filters left, search, paging) or the Kanban board by status. */
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const user = await requirePageUser();
  if (!can(user, "lead.view")) return <ForbiddenState />;

  const t = await getTranslations("leads");
  const tStatus = await getTranslations("status.lead");
  const params = await searchParams;
  const [channels, sources, needs] = await Promise.all([
    listOptions("leadChannels", true),
    listOptions("leadSources", true),
    listOptions("needGroups", true),
  ]);
  const pick = (options: { id: string }[], param: string | string[] | undefined) =>
    options.find((o) => o.id === filterValue(param))?.id;
  const q = filterValue(params.q) ?? "";
  const status = LEAD_STATUSES.find((value) => value === filterValue(params.status));
  const channelId = pick(channels, params.channel);
  const sourceId = pick(sources, params.source);
  const needGroupId = pick(needs, params.need);
  const { page, pageSize } = readPaging(params);
  const onBoard = filterValue(params.view) === "board";
  const [result, board] = await Promise.all([
    onBoard ? null : listLeads({ q, status, channelId, sourceId, needGroupId, page, pageSize }),
    onBoard ? getLeadBoard({ q, channelId, sourceId, needGroupId }) : null,
  ]);
  const filtered = Boolean(q || status || channelId || sourceId || needGroupId);
  const label = (option: { labelVi: string; labelEn: string }) =>
    user.locale === "vi" ? option.labelVi : option.labelEn;

  const kept = {
    view: onBoard ? "board" : undefined,
    q,
    status: onBoard ? undefined : status,
    channel: channelId,
    source: sourceId,
    need: needGroupId,
  };
  const viewHref = (view: "list" | "board") => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({
      ...kept,
      view: view === "board" ? "board" : undefined,
      status: undefined,
    }))
      if (value) query.set(key, value);
    const search = query.toString();
    return search ? `/leads?${search}` : "/leads";
  };
  const statusHref = (target: string) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...kept, view: undefined, status: target }))
      if (value) query.set(key, value);
    return `/leads?${query.toString()}`;
  };
  const hidden = (except: keyof typeof kept) =>
    Object.entries(kept)
      .filter(([key, value]) => key !== except && value)
      .map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={can(user, "lead.create") && <AddLeadButton branches={user.branches} />}
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/leads" label={t("filters")} submitLabel={t("apply")}>
          {q && <input type="hidden" name="q" value={q} />}
          {onBoard && <input type="hidden" name="view" value="board" />}
          {!onBoard && (
            <FilterSelect
              name="status"
              label={t("fields.status")}
              allLabel={t("all")}
              value={status}
              options={LEAD_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
            />
          )}
          <FilterSelect
            name="channel"
            label={t("fields.channel")}
            allLabel={t("all")}
            value={channelId}
            options={channels.map((o) => ({ value: o.id, label: label(o) }))}
          />
          <FilterSelect
            name="source"
            label={t("fields.source")}
            allLabel={t("all")}
            value={sourceId}
            options={sources.map((o) => ({ value: o.id, label: label(o) }))}
          />
          <FilterSelect
            name="need"
            label={t("fields.needGroup")}
            allLabel={t("all")}
            value={needGroupId}
            options={needs.map((o) => ({ value: o.id, label: label(o) }))}
          />
        </FilterPanel>
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Form action="/leads" role="search" className="relative w-full max-w-sm">
              {hidden("q")}
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                type="search"
                defaultValue={q}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="pl-8"
              />
            </Form>
            <nav aria-label={t("views")} className="flex gap-1">
              <Button asChild size="sm" variant={onBoard ? "ghost" : "secondary"}>
                <Link href={viewHref("list")} aria-current={onBoard ? undefined : "page"}>
                  <ListIcon />
                  {t("listView")}
                </Link>
              </Button>
              <Button asChild size="sm" variant={onBoard ? "secondary" : "ghost"}>
                <Link href={viewHref("board")} aria-current={onBoard ? "page" : undefined}>
                  <KanbanSquareIcon />
                  {t("boardView")}
                </Link>
              </Button>
            </nav>
          </div>
          {board ? (
            <LeadsBoard board={board} listHref={statusHref} />
          ) : (
            result && (
              <LeadsTable
                leads={result.items}
                empty={
                  filtered ? (
                    <EmptyState icon={SearchIcon} title={t("noResultsTitle")} description={t("noResultsBody")} />
                  ) : (
                    <EmptyState icon={MegaphoneIcon} title={t("emptyTitle")} description={t("emptyBody")} />
                  )
                }
                footer={
                  <TablePagination
                    page={result.page}
                    pageSize={result.pageSize}
                    total={result.total}
                    path="/leads"
                    params={params}
                  />
                }
              />
            )
          )}
        </div>
      </div>
    </>
  );
}
