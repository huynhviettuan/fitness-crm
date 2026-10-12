import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { SearchIcon, UsersIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { FilterInput, FilterPanel, FilterSelect } from "@/components/filter-panel";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { filterValue } from "@/lib/filters";
import { parseDateOnly } from "@flow/shared/validation";
import { listCustomerStaff, listCustomers } from "@/lib/api/customers";
import { CreateCustomerButton } from "./customer-sheets";
import { CustomersTable } from "./customers-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
/** A day typed as dd/MM/yyyy; anything else is ignored rather than refused. */
const day = (param: string | string[] | undefined) => {
  const value = filterValue(param);
  return value && parseDateOnly(value) ? value : undefined;
};

/** Customers in the shared list template (brief §1, §4.2): filters left, search, table with paging. */
export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requirePageUser();
  if (!can(user, "customer.view")) return <ForbiddenState />;
  const t = await getTranslations("customers");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const { page, pageSize } = readPaging(params);
  const staff = await listCustomerStaff();
  const branchId = user.branches.find((branch) => branch.id === filterValue(params.branch))?.id;
  const staffId = staff.find((person) => person.id === filterValue(params.staff))?.id;
  const registeredFrom = day(params.from);
  const registeredTo = day(params.to);
  const birthdayMonth = MONTHS.find((month) => String(month) === filterValue(params.birthday));
  const noEmail = filterValue(params.email) === "none";

  const result = await listCustomers({
    q,
    page,
    pageSize,
    branchId,
    staffId,
    registeredFrom,
    registeredTo,
    birthdayMonth,
    noEmail,
  });
  const canManage = can(user, "customer.manage");
  const filtered = Boolean(q || branchId || staffId || registeredFrom || registeredTo || birthdayMonth || noEmail);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {can(user, "customer.export") && (
              <ExportButton
                path="/api/v1/customers/export"
                query={{ search: q, branchId, staffId, registeredFrom, registeredTo, birthdayMonth, noEmail }}
              />
            )}
            {canManage && <CreateCustomerButton branches={user.branches} staff={staff} />}
          </>
        }
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <FilterPanel action="/customers" label={t("filters")} submitLabel={t("apply")}>
          {q && <input type="hidden" name="q" value={q} />}
          {user.branches.length > 1 && (
            <FilterSelect
              name="branch"
              label={t("fields.branch")}
              allLabel={t("allBranches")}
              value={branchId}
              options={user.branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          )}
          <FilterSelect
            name="staff"
            label={t("fields.staffInCharge")}
            allLabel={t("allStaff")}
            value={staffId}
            options={staff.map((person) => ({ value: person.id, label: person.name }))}
          />
          <FilterInput name="from" label={t("registeredFrom")} value={registeredFrom} placeholder={t("dayHint")} />
          <FilterInput name="to" label={t("registeredTo")} value={registeredTo} placeholder={t("dayHint")} />
          <FilterSelect
            name="birthday"
            label={t("birthdayMonth")}
            allLabel={t("allMonths")}
            value={birthdayMonth ? String(birthdayMonth) : undefined}
            options={MONTHS.map((month) => ({ value: String(month), label: t("month", { month }) }))}
          />
          <FilterSelect
            name="email"
            label={t("emailFilter")}
            allLabel={t("allEmails")}
            value={noEmail ? "none" : undefined}
            options={[{ value: "none", label: t("onlyNoEmail") }]}
          />
        </FilterPanel>
        <div className="min-w-0">
          <Form action="/customers" role="search" className="relative mb-4 max-w-sm">
            {branchId && <input type="hidden" name="branch" value={branchId} />}
            {staffId && <input type="hidden" name="staff" value={staffId} />}
            {registeredFrom && <input type="hidden" name="from" value={registeredFrom} />}
            {registeredTo && <input type="hidden" name="to" value={registeredTo} />}
            {birthdayMonth && <input type="hidden" name="birthday" value={birthdayMonth} />}
            {noEmail && <input type="hidden" name="email" value="none" />}
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
          <CustomersTable
            customers={result.items}
            empty={
              filtered ? (
                <EmptyState
                  icon={SearchIcon}
                  title={t("noResultsTitle")}
                  description={q ? t("noResultsBody", { q }) : t("noResultsFilters")}
                />
              ) : (
                <EmptyState icon={UsersIcon} title={t("emptyTitle")} description={t("emptyBody")} />
              )
            }
            footer={
              <TablePagination
                page={result.page}
                pageSize={result.pageSize}
                total={result.total}
                path="/customers"
                params={params}
              />
            }
          />
        </div>
      </div>
    </>
  );
}
