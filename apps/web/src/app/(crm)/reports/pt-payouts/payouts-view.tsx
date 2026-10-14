"use client";

import { useTranslations } from "next-intl";
import { HandCoinsIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { TablePagination } from "@/components/table-pagination";
import type { SearchParams } from "@/lib/paging";
import type { PtPayout, PtPayoutPage } from "@flow/shared/payouts";

/** The payouts to PTs (M5.7): a payout whose voucher was deleted or rejected stands no more and says so. */
export function PayoutsView({ result, params }: { result: PtPayoutPage; params: SearchParams }) {
  const t = useTranslations("ptPayouts");

  const columns: DataTableColumn<PtPayout>[] = [
    {
      id: "number",
      header: t("fields.number"),
      cell: ({ row }) => <span className="font-medium">{row.original.number}</span>,
    },
    {
      id: "trainer",
      header: t("fields.trainer"),
      cell: ({ row }) => `${row.original.trainer.fullName} (${row.original.trainer.employeeCode})`,
    },
    {
      id: "period",
      header: t("fields.period"),
      cell: ({ row }) => (
        <>
          <DateTime value={row.original.periodFrom} /> – <DateTime value={row.original.periodTo} />
        </>
      ),
    },
    { id: "amount", header: t("fields.amount"), cell: ({ row }) => <Money amount={row.original.amount} /> },
    {
      id: "sessions",
      header: t("fields.sessions"),
      cell: ({ row }) => row.original.sessionCount,
    },
    {
      id: "adjustments",
      header: t("fields.adjustments"),
      cell: ({ row }) =>
        row.original.adjustmentCount === 0 ? (
          "—"
        ) : (
          <>
            {row.original.adjustmentCount} · <Money amount={row.original.adjustmentAmount} />
          </>
        ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) =>
        row.original.void ? (
          <Badge variant="muted">{t("void")}</Badge>
        ) : (
          <StatusBadge entity="approval" status={row.original.approvalStatus} />
        ),
    },
    {
      id: "created",
      header: t("fields.created"),
      cell: ({ row }) => (
        <div>
          <DateTime value={row.original.createdAt} format="dateTime" />
          <div className="text-xs text-muted-foreground">{row.original.createdBy}</div>
        </div>
      ),
    },
  ];

  return (
    <div className="min-w-0">
      <DataTable
        columns={columns}
        data={result.items}
        label={t("title")}
        empty={<EmptyState icon={HandCoinsIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
        footer={
          <TablePagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            path="/reports/pt-payouts"
            params={params}
          />
        }
      />
    </div>
  );
}
