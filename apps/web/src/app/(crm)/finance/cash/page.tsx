import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReceiptTextIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { formatMonth } from "@/lib/format";
import { can } from "@/lib/permissions";
import { financeSummary, listCashTransactions } from "@/lib/api/finance";
import { CashTable, RecordCashButton } from "../cash";
import { FinanceTabs, MonthNav } from "../finance-nav";
import { pageParam, selectedMonth } from "../month";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.cash")} · ${t("title")}` };
}

/** Income and expenses of one month, with the month's totals (FR-CASH-001, FR-CASH-002). */
export default async function CashPage({ searchParams }: PageProps<"/finance/cash">) {
  const user = await requirePageUser();
  if (!can(user, "cash.manage")) return <ForbiddenState />;

  const t = await getTranslations("finance");
  const params = await searchParams;
  const month = selectedMonth(params.month);
  const [summary, result] = await Promise.all([
    financeSummary(month.query),
    listCashTransactions({ ...month.query, page: pageParam(params.page) }),
  ]);
  // OQ-007 interim: payments and other income are separate lines, and there is no net figure.
  const totals = [
    { label: t("contractPayments"), amount: summary.contractPayments },
    { label: t("otherIncome"), amount: summary.otherIncome },
    { label: t("expense"), amount: summary.expense },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<RecordCashButton branches={user.branches} />}
      />
      <FinanceTabs active="cash" showCash />
      <MonthNav path="/finance/cash" month={month.from} thisMonth={month.thisMonth} />
      <section aria-label={t("month", { month: formatMonth(month.from) })} className="mb-2 grid gap-4 sm:grid-cols-3">
        {totals.map(({ label, amount }) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{label}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {amount === null ? <HiddenValue /> : <Money amount={amount} />}
            </CardContent>
          </Card>
        ))}
      </section>
      <p className="mb-6 text-xs text-muted-foreground">{t("summaryNote")}</p>
      <CashTable
        transactions={result.items}
        canDelete={can(user, "cash.delete")}
        label={t("tabs.cash")}
        empty={<EmptyState icon={ReceiptTextIcon} title={t("cashEmpty")} />}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            hrefFor={(page) => `/finance/cash?month=${month.param}${page > 1 ? `&page=${page}` : ""}`}
          />
        }
      />
    </>
  );
}
