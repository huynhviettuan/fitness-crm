"use client";

import { useTranslations } from "next-intl";
import { TagsIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import type { ExceptionPriceReport, ExceptionPriceRow } from "@flow/shared/contracts";

/** The exception-price report (brief §9, BR-302, A-141): the share of exception prices and their cost, by creator and approver. */
export function ExceptionPricesView({ report }: { report: ExceptionPriceReport }) {
  const t = useTranslations("exceptionPrices");

  if (report.totals.contracts === 0) return <EmptyState icon={TagsIcon} title={t("empty")} />;

  const columns: DataTableColumn<ExceptionPriceRow>[] = [
    {
      id: "user",
      header: t("fields.person"),
      cell: ({ row }) => <span className="font-medium">{row.original.user.name}</span>,
    },
    { id: "contracts", header: t("fields.contracts"), cell: ({ row }) => row.original.contracts },
    { id: "exceptions", header: t("fields.exceptions"), cell: ({ row }) => row.original.exceptions },
    { id: "share", header: t("fields.share"), cell: ({ row }) => `${row.original.share}%` },
    { id: "difference", header: t("fields.difference"), cell: ({ row }) => <Money amount={row.original.difference} /> },
  ];
  const totals = [
    { key: "contracts", value: <>{report.totals.contracts}</> },
    { key: "exceptions", value: <>{report.totals.exceptions}</> },
    { key: "share", value: <>{report.totals.share}%</> },
    { key: "difference", value: <Money amount={report.totals.difference} /> },
  ] as const;
  const sections = [
    { key: "byCreator", rows: report.byCreator },
    { key: "byApprover", rows: report.byApprover },
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("totals")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {totals.map(({ key, value }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{t(`fields.${key}`)}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">{value}</CardContent>
          </Card>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      {sections.map(({ key, rows }) => (
        <Card key={key} role="region" aria-label={t(key)}>
          <CardHeader>
            <CardTitle>{t(key)}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable columns={columns} data={rows} label={t(key)} empty={null} getRowId={(row) => row.user.id} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
