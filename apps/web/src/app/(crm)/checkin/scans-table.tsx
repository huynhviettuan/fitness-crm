"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import type { CheckinScan, ScanErrorCode } from "@gymcrm/shared/checkin";

type Props = { scans: CheckinScan[]; view: "errors" | "scans"; footer: ReactNode };

/** The scans received; the error list is the same list filtered to errors (D-070). */
export function ScansTable({ scans, view, footer }: Props) {
  const t = useTranslations("checkin");
  const columns: DataTableColumn<CheckinScan>[] = [
    {
      id: "time",
      header: t("fields.time"),
      cell: ({ row }) => <DateTime value={row.original.scannedAt} format="dateTime" />,
    },
    { id: "device", header: t("fields.device"), cell: ({ row }) => row.original.device },
    {
      id: "code",
      header: t("fields.code"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.userCode}</span>,
    },
    {
      id: "person",
      header: t("fields.person"),
      cell: ({ row }) => row.original.subject?.name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "result",
      header: t("fields.result"),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              row.original.result === "ERROR" ? "destructive" : row.original.result === "PAIRED" ? "success" : "muted"
            }
          >
            {t(`results.${row.original.result}`)}
          </Badge>
          {row.original.errorCode && (
            <span className="text-sm">{t(`scanErrors.${row.original.errorCode as ScanErrorCode}`)}</span>
          )}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={scans}
      label={t(`views.${view}`)}
      empty={<p className="p-6 text-center text-sm text-muted-foreground">{t("scansEmpty")}</p>}
      getRowId={(row) => row.id}
      footer={footer}
    />
  );
}
