import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BanknoteIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { collectedBetween, listPayments } from "@/lib/api/finance";
import { FinanceTabs, MonthNav } from "../finance-nav";
import { pageParam, selectedMonth } from "../month";
import { PaymentsTable } from "../payments";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: `${t("tabs.payments")} · ${t("title")}` };
}

/** Contract payments of one month, newest first (FR-PAY-002). */
export default async function PaymentsPage({ searchParams }: PageProps<"/finance/payments">) {
  const user = await requirePageUser();
  if (!can(user, "payment.view")) return <ForbiddenState />;

  const t = await getTranslations("finance");
  const params = await searchParams;
  const month = selectedMonth(params.month);
  const [result, collected] = await Promise.all([
    listPayments({ ...month.query, page: pageParam(params.page) }),
    collectedBetween(month.query),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <FinanceTabs active="payments" showCash={can(user, "cash.manage")} />
      <MonthNav path="/finance/payments" month={month.from} thisMonth={month.thisMonth} />
      <p className="mb-4 text-sm">
        <span className="text-muted-foreground">{t("collected")}: </span>
        <span className="font-semibold">{collected === null ? <HiddenValue /> : <Money amount={collected} />}</span>
      </p>
      <PaymentsTable
        payments={result.items}
        canDelete={can(user, "payment.delete")}
        label={t("tabs.payments")}
        empty={<EmptyState icon={BanknoteIcon} title={t("paymentsEmpty")} />}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            hrefFor={(page) => `/finance/payments?month=${month.param}${page > 1 ? `&page=${page}` : ""}`}
          />
        }
      />
    </>
  );
}
