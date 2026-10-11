import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { InboxIcon, ListTodoIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { filterValue } from "@/lib/filters";
import { getApprovalSummary } from "@/lib/api/approvals";
import { getTaskAssignees, listTasks } from "@/lib/api/tasks";
import { TASK_STATUSES, TASK_VIEWS } from "@flow/shared/tasks";
import { CreateTaskButton } from "./task-form";
import { TasksTable } from "./tasks-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tasks");
  return { title: t("title") };
}

/**
 * Giao việc (brief §8.2, FR-TASK-005): my tasks, tasks I gave, my department's, and —
 * for whoever sees every task of the branch — all. Filters on the left, search, paging.
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const user = await requirePageUser();
  if (!can(user, "task.view")) return <ForbiddenState />;

  const t = await getTranslations("tasks");
  const tStatus = await getTranslations("status.task");
  const params = await searchParams;
  const views = TASK_VIEWS.filter((view) => view !== "all" || user.dataScopes.tasks === "ALL");
  const view = views.find((v) => v === params.view) ?? "mine";
  const status = TASK_STATUSES.find((value) => value === filterValue(params.status));
  const overdueOnly = filterValue(params.deadline) === "overdue";
  const q = filterValue(params.q) ?? "";
  const page = Math.max(1, Number(params.page) || 1);
  const [result, approvals, assignees] = await Promise.all([
    listTasks({ view, status, overdueOnly, q, page }),
    view === "mine" ? getApprovalSummary() : Promise.resolve(null),
    can(user, "task.create") ? getTaskAssignees() : Promise.resolve(null),
  ]);

  const query = (target: { view?: string; page?: number }) => {
    const search = new URLSearchParams();
    search.set("view", target.view ?? view);
    if (!target.view) {
      if (status) search.set("status", status);
      if (overdueOnly) search.set("deadline", "overdue");
      if (q) search.set("q", q);
      if (target.page && target.page > 1) search.set("page", String(target.page));
    }
    return `/tasks?${search.toString()}`;
  };
  const filtered = Boolean(status || overdueOnly || q);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={assignees && <CreateTaskButton assignees={assignees} branches={user.branches} />} />
      {/* D-018: the approver gets their approvals in the task module; they are decided in the inbox. */}
      {approvals && approvals.toDecide > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm">
          <span>{t("awaitingApproval", { count: approvals.toDecide })}</span>
          <Button asChild variant="outline" size="sm">
            <Link href="/approvals">
              <InboxIcon />
              {t("openApprovals")}
            </Link>
          </Button>
        </div>
      )}
      <nav aria-label={t("title")} className="mb-4 flex flex-wrap gap-1 border-b">
        {views.map((v) => (
          <Link
            key={v}
            href={query({ view: v })}
            aria-current={v === view ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
              v === view ? "border-primary font-medium text-foreground" : "border-transparent",
            )}
          >
            {t(`views.${v}`)}
          </Link>
        ))}
      </nav>
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/tasks" label={t("filters")} submitLabel={t("apply")}>
          <input type="hidden" name="view" value={view} />
          {q && <input type="hidden" name="q" value={q} />}
          <FilterSelect
            name="status"
            label={t("fields.status")}
            allLabel={t("allStatuses")}
            value={status}
            options={TASK_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
          />
          <FilterSelect
            name="deadline"
            label={t("deadline")}
            allLabel={t("anyDeadline")}
            value={overdueOnly ? "overdue" : undefined}
            options={[{ value: "overdue", label: t("overdueOnly") }]}
          />
        </FilterPanel>
        <div className="min-w-0">
          <Form action="/tasks" role="search" className="relative mb-4 max-w-sm">
            <input type="hidden" name="view" value={view} />
            {status && <input type="hidden" name="status" value={status} />}
            {overdueOnly && <input type="hidden" name="deadline" value="overdue" />}
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="pl-8" />
          </Form>
          <TasksTable
            tasks={result.items}
            label={t(`views.${view}`)}
            empty={<EmptyState icon={filtered ? SearchIcon : ListTodoIcon} title={filtered ? t("noResults") : t(`empty.${view}`)} />}
            footer={<TablePagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(target) => query({ page: target })} />}
          />
        </div>
      </div>
    </>
  );
}
