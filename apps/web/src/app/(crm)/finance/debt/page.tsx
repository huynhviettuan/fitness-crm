import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CircleCheckIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@flow/shared/permissions";
import { listDebts } from "@/modules/finance/payment.service";
import { ContractsTable } from "../../contracts/contracts-table";
import { FinanceTabs } from "../finance-nav";
import { pageParam } from "../month";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.debt")} · ${t("title")}` };
}

/** Contracts that still owe money, largest first (BR-013, A-022). */
export default async function DebtPage({ searchParams }: PageProps<"/finance/debt">) {
  const user = await requirePageUser();
  if (!can(user.role, "payment.view")) return <ForbiddenState />;

  const t = await getTranslations("finance");
  const result = await listDebts(user, { page: pageParam((await searchParams).page) });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <FinanceTabs active="debt" showCash={can(user.role, "cash.manage")} />
      <p className="mb-4 text-sm text-muted-foreground">{t("debtDescription")}</p>
      <ContractsTable
        contracts={result.items}
        empty={<EmptyState icon={CircleCheckIcon} title={t("debtEmpty")} />}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            hrefFor={(page) => (page > 1 ? `/finance/debt?page=${page}` : "/finance/debt")}
          />
        }
      />
    </>
  );
}
