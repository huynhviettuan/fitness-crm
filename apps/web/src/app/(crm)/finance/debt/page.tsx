import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CircleCheckIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { readPaging } from "@/lib/paging";
import { listDebts } from "@/lib/api/finance";
import { ContractsTable } from "../../contracts/contracts-table";
import { FinanceTabs } from "../finance-nav";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.debt")} · ${t("title")}` };
}

/** Contracts that still owe money, largest first (BR-013, A-022). */
export default async function DebtPage({ searchParams }: PageProps<"/finance/debt">) {
  const user = await requirePageUser();
  if (!can(user, "payment.view")) return <ForbiddenState />;

  const t = await getTranslations("finance");
  const params = await searchParams;
  const { page, pageSize } = readPaging(params);
  const result = await listDebts({ page, pageSize });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={can(user, "report.memberDebtExport") && <ExportButton path="/api/v1/debts/export" query={{}} />}
      />
      <FinanceTabs active="debt" showCash={can(user, "cash.manage")} />
      <p className="mb-4 text-sm text-muted-foreground">{t("debtDescription")}</p>
      <ContractsTable
        contracts={result.items}
        empty={<EmptyState icon={CircleCheckIcon} title={t("debtEmpty")} />}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            path="/finance/debt"
            params={params}
          />
        }
      />
    </>
  );
}
