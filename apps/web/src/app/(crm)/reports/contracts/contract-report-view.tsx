"use client";

import { useTranslations } from "next-intl";
import { FileChartColumnIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { bandLabel, type ContractReport, type ContractReportRow } from "@gymcrm/shared/contracts";

/** The contract report (brief §9, A-140): revenue, debt, new and renewed contracts, expiring and running out, by service and band. */
export function ContractReportView({ report }: { report: ContractReport }) {
  const t = useTranslations("contractReport");

  if (report.rows.length === 0) return <EmptyState icon={FileChartColumnIcon} title={t("empty")} />;

  const columns: DataTableColumn<ContractReportRow>[] = [
    {
      id: "service",
      header: t("fields.service"),
      cell: ({ row }) => <span className="font-medium">{row.original.service?.name ?? t("noService")}</span>,
    },
    {
      id: "band",
      header: t("fields.band"),
      cell: ({ row }) => (row.original.band ? bandLabel(row.original.band) : "—"),
    },
    { id: "newContracts", header: t("fields.newContracts"), cell: ({ row }) => row.original.newContracts },
    { id: "renewedContracts", header: t("fields.renewedContracts"), cell: ({ row }) => row.original.renewedContracts },
    { id: "value", header: t("fields.value"), cell: ({ row }) => <Money amount={row.original.value} /> },
    { id: "revenue", header: t("fields.revenue"), cell: ({ row }) => <Money amount={row.original.revenue} /> },
    { id: "debt", header: t("fields.debt"), cell: ({ row }) => <Money amount={row.original.debt} /> },
    { id: "expiringSoon", header: t("fields.expiringSoon"), cell: ({ row }) => row.original.expiringSoon },
    { id: "runningOut", header: t("fields.runningOut"), cell: ({ row }) => row.original.runningOut },
  ];
  const totals = [
    { key: "newContracts", value: report.totals.newContracts, money: false },
    { key: "renewedContracts", value: report.totals.renewedContracts, money: false },
    { key: "revenue", value: report.totals.revenue, money: true },
    { key: "debt", value: report.totals.debt, money: true },
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("totals")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {totals.map((entry) => (
          <Card key={entry.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{t(`fields.${entry.key}`)}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {entry.money ? <Money amount={entry.value} /> : entry.value}
            </CardContent>
          </Card>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      <Card role="region" aria-label={t("byService")}>
        <CardHeader>
          <CardTitle>{t("byService")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={report.rows}
            label={t("byService")}
            empty={null}
            getRowId={(row) => `${row.service?.id ?? "none"}:${row.band?.min ?? "none"}`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
