import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { SearchIcon, UsersIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@flow/shared/permissions";
import { listCustomers } from "@/modules/customers/customer.service";
import { CreateCustomerButton } from "./customer-sheets";
import { CustomersTable } from "./customers-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("title") };
}

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requirePageUser();
  const t = await getTranslations("customers");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const result = await listCustomers(user, { q, page });
  const canManage = can(user.role, "customer.manage");

  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/customers?${search}` : "/customers";
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={canManage && <CreateCustomerButton />} />
      <Form action="/customers" role="search" className="relative mb-4 max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="pl-8" />
      </Form>
      <CustomersTable
        customers={result.items}
        empty={
          q ? (
            <EmptyState icon={SearchIcon} title={t("noResultsTitle")} description={t("noResultsBody", { q })} />
          ) : (
            <EmptyState icon={UsersIcon} title={t("emptyTitle")} description={t("emptyBody")} />
          )
        }
        footer={<TablePagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />}
      />
    </>
  );
}
