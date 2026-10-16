"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { NotebookPenIcon } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import type { LogSummary } from "@gymcrm/shared/workouts";

/** A list of session logs, each a link to its page (M7.3). */
export function LogsTable({ logs, label }: { logs: LogSummary[]; label: string }) {
  const t = useTranslations("workoutLogs");
  const columns: DataTableColumn<LogSummary>[] = [
    {
      id: "date",
      header: t("fields.date"),
      cell: ({ row }) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/workouts/logs/${row.original.id}`}>
          <DateTime value={row.original.sessionDate} format="dateTime" />
        </Link>
      ),
    },
    {
      id: "customer",
      header: t("fields.customer"),
      cell: ({ row }) => `${row.original.customer.fullName} · ${row.original.customer.customerCode}`,
    },
    { id: "trainer", header: t("fields.trainer"), cell: ({ row }) => row.original.trainer.fullName },
    { id: "plan", header: t("fields.plan"), cell: ({ row }) => row.original.plan?.name ?? "—" },
    { id: "exercises", header: t("fields.exercises"), cell: ({ row }) => row.original.exercises },
    { id: "sets", header: t("fields.sets"), cell: ({ row }) => row.original.sets },
  ];
  return (
    <DataTable
      columns={columns}
      data={logs}
      label={label}
      empty={<EmptyState icon={NotebookPenIcon} title={t("empty")} />}
      getRowId={(row) => row.id}
    />
  );
}
