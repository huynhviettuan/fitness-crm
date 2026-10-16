"use client";

import { useLocale, useTranslations } from "next-intl";
import { ScaleIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { optionLabel } from "@/components/option-select";
import type { IncomeExpense, MoneyLine } from "@gymcrm/shared/finance";

/** Income and expense of a period by category (A-139): contract payments, other income, and expenses; net = income − expense. */
export function IncomeExpenseView({ report }: { report: IncomeExpense }) {
  const t = useTranslations("incomeExpense");
  const locale = useLocale();

  if (report.lines.every((line) => line.count === 0)) return <EmptyState icon={ScaleIcon} title={t("empty")} />;

  const columns: DataTableColumn<MoneyLine>[] = [
    { id: "kind", header: t("fields.kind"), cell: ({ row }) => t(`kinds.${row.original.kind}`) },
    {
      id: "category",
      header: t("fields.category"),
      cell: ({ row }) => (row.original.category ? optionLabel(row.original.category, locale) : "—"),
    },
    { id: "count", header: t("fields.count"), cell: ({ row }) => row.original.count },
    { id: "amount", header: t("fields.amount"), cell: ({ row }) => <Money amount={row.original.amount} /> },
  ];
  const totals = [
    { key: "income", amount: report.income },
    { key: "expense", amount: report.expense },
    { key: "net", amount: report.net },
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("totals")} className="grid gap-4 sm:grid-cols-3">
        {totals.map(({ key, amount }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{t(`fields.${key}`)}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              <Money amount={amount} />
            </CardContent>
          </Card>
        ))}
      </section>
      <Card role="region" aria-label={t("lines")}>
        <CardHeader>
          <CardTitle>{t("lines")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={report.lines}
            label={t("lines")}
            empty={null}
            getRowId={(line) => `${line.kind}:${line.category?.id ?? ""}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
