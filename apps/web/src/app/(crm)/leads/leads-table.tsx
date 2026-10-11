"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { HiddenValue } from "@/components/hidden-value";
import { ChosenOptionText } from "@/components/option-select";
import { StatusBadge } from "@/components/status-badge";
import type { Lead } from "@flow/shared/leads";

/** The lead list (FR-LEAD-006); the name opens the lead. */
export function LeadsTable({ leads, empty, footer }: { leads: Lead[]; empty: React.ReactNode; footer?: React.ReactNode }) {
  const t = useTranslations("leads");

  const columns: DataTableColumn<Lead>[] = [
    {
      id: "fullName",
      header: t("fields.fullName"),
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <Link href={`/leads/${row.original.id}`} aria-label={t("open", { name: row.original.fullName })} className="font-medium underline-offset-4 hover:underline">
            {row.original.fullName}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{row.original.leadCode}</span>
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
          <span className="tabular-nums">{row.original.phone ?? <span className="text-muted-foreground">{t("noPhone")}</span>}</span>
        ),
    },
    { id: "channel", header: t("fields.channel"), cell: ({ row }) => <ChosenOptionText option={row.original.channel} /> },
    { id: "source", header: t("fields.source"), cell: ({ row }) => (row.original.source ? <ChosenOptionText option={row.original.source} /> : null) },
    { id: "need", header: t("need"), cell: ({ row }) => (row.original.needGroup ? <ChosenOptionText option={row.original.needGroup} /> : null) },
    { id: "pic", header: t("fields.pic"), cell: ({ row }) => row.original.pic?.name ?? <span className="text-muted-foreground">{t("noPic")}</span> },
    { id: "createdAt", header: t("fields.createdAt"), cell: ({ row }) => <DateTime value={row.original.createdAt} /> },
    { id: "status", header: t("fields.status"), cell: ({ row }) => <StatusBadge entity="lead" status={row.original.status} /> },
  ];

  return <DataTable columns={columns} data={leads} label={t("title")} empty={empty} getRowId={(row) => row.id} footer={footer} />;
}
