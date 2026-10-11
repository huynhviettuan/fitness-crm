import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { IdCardIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { filterValue } from "@/lib/filters";
import { listOptions } from "@/lib/api/configuration";
import { listEmployeeLogins, listEmployees } from "@/lib/api/employees";
import { EMPLOYEE_STATUSES } from "@flow/shared/employees";
import { CreateEmployeeButton } from "./employee-form";
import { EmployeesTable } from "./employees-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employees");
  return { title: t("title") };
}

/** Employees (brief §8.4), in the shared list template: filters left, search, paging. */
export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const user = await requirePageUser();
  if (!can(user, "employee.view")) return <ForbiddenState />;

  const t = await getTranslations("employees");
  const tStatus = await getTranslations("status.employee");
  const params = await searchParams;
  const q = filterValue(params.q) ?? "";
  const status = EMPLOYEE_STATUSES.find((value) => value === filterValue(params.status));
  const departments = await listOptions("departments", true);
  const departmentId = departments.find((option) => option.id === filterValue(params.department))?.id;
  const trainersOnly = filterValue(params.kind) === "trainers";
  const page = Math.max(1, Number(params.page) || 1);
  const canManage = can(user, "employee.manage");

  const [result, logins] = await Promise.all([
    listEmployees({ q, status, departmentId, trainersOnly, page }),
    canManage ? listEmployeeLogins() : Promise.resolve([]),
  ]);
  const filtered = Boolean(q || status || departmentId || trainersOnly);

  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (departmentId) query.set("department", departmentId);
    if (trainersOnly) query.set("kind", "trainers");
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/employees?${search}` : "/employees";
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={canManage && <CreateEmployeeButton logins={logins} branches={user.branches} />} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/employees" label={t("filters")} submitLabel={t("apply")}>
          {q && <input type="hidden" name="q" value={q} />}
          <FilterSelect
            name="status"
            label={t("fields.status")}
            allLabel={t("allStatuses")}
            value={status}
            options={EMPLOYEE_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
          />
          <FilterSelect
            name="department"
            label={t("fields.department")}
            allLabel={t("allDepartments")}
            value={departmentId}
            options={departments.map((option) => ({ value: option.id, label: user.locale === "vi" ? option.labelVi : option.labelEn }))}
          />
          <FilterSelect
            name="kind"
            label={t("trainersOnly")}
            allLabel={t("allEmployees")}
            value={trainersOnly ? "trainers" : undefined}
            options={[{ value: "trainers", label: t("onlyTrainers") }]}
          />
        </FilterPanel>
        <div className="min-w-0">
          <Form action="/employees" role="search" className="relative mb-4 max-w-sm">
            {status && <input type="hidden" name="status" value={status} />}
            {departmentId && <input type="hidden" name="department" value={departmentId} />}
            {trainersOnly && <input type="hidden" name="kind" value="trainers" />}
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="pl-8" />
          </Form>
          <EmployeesTable
            employees={result.items}
            empty={
              filtered ? (
                <EmptyState icon={SearchIcon} title={t("noResultsTitle")} description={t("noResultsBody")} />
              ) : (
                <EmptyState icon={IdCardIcon} title={t("emptyTitle")} description={t("emptyBody")} />
              )
            }
            footer={<TablePagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />}
          />
        </div>
      </div>
    </>
  );
}
