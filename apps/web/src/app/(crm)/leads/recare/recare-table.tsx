"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { HiddenValue } from "@/components/hidden-value";
import { ChosenOptionText } from "@/components/option-select";
import { StatusBadge } from "@/components/status-badge";
import type { RecareRow } from "@gymcrm/shared/leads";

/** The re-care list (FR-LEAD-007); the name opens the lead. Scrolls sideways inside its frame on a phone. */
export function RecareTable({
  rows,
  empty,
  footer,
}: {
  rows: RecareRow[];
  empty: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("recare");

  const columns: DataTableColumn<RecareRow>[] = [
    {
      id: "lead",
      header: t("fields.lead"),
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <Link
            href={`/leads/${row.original.id}`}
            aria-label={t("open", { name: row.original.fullName })}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.fullName}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{row.original.leadCode}</span>
        </span>
      ),
    },
    {
      id: "contactAgainOn",
      header: t("fields.contactAgainOn"),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          {row.original.contactAgainOn ? (
            <DateTime value={row.original.contactAgainOn} format="dateOnly" />
          ) : (
            <span className="text-muted-foreground">{t("noDate")}</span>
          )}
          {row.original.overdue && <Badge variant="destructive">{t("overdue")}</Badge>}
        </span>
      ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge entity="lead" status={row.original.status} />
          {row.original.refuseReason && (
            <span className="text-xs text-muted-foreground">
              <ChosenOptionText option={row.original.refuseReason} />
            </span>
          )}
        </span>
      ),
    },
    {
      id: "phone",
      header: t("fields.phone"),
      cell: ({ row }) =>
        row.original.maskedFields.includes("phone") ? (
          <HiddenValue />
        ) : (
          <span className="tabular-nums">
            {row.original.phone ?? <span className="text-muted-foreground">{t("noPhone")}</span>}
          </span>
        ),
    },
    {
      id: "pic",
      header: t("fields.pic"),
      cell: ({ row }) => row.original.pic?.name ?? <span className="text-muted-foreground">{t("noPic")}</span>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      label={t("title")}
      empty={empty}
      getRowId={(row) => row.id}
      footer={footer}
    />
  );
}
