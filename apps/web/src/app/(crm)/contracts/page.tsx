import type { Metadata } from "next";
import Form from "next/form";
import { getTranslations } from "next-intl/server";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listContracts } from "@/lib/api/contracts";
import { ContractsTable } from "./contracts-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("title") };
}

// Contracts are created from a customer's page, so this list has no create button.
export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const user = await requirePageUser();
  if (!can(user, "contract.view")) return <ForbiddenState />;
  const t = await getTranslations("contracts");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const result = await listContracts({ q, page });

  const hrefFor = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `/contracts?${search}` : "/contracts";
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <Form action="/contracts" role="search" className="relative mb-4 max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="pl-8" />
      </Form>
      <ContractsTable
        contracts={result.items}
        empty={
          q ? (
            <EmptyState icon={SearchIcon} title={t("noResultsTitle")} description={t("noResultsBody", { q })} />
          ) : (
            <EmptyState icon={FileTextIcon} title={t("emptyTitle")} description={t("emptyBody")} />
          )
        }
        footer={<TablePagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />}
      />
    </>
  );
}
