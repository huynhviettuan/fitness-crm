"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ClipboardListIcon } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type { PlanSummary } from "@flow/shared/workouts";

/** A list of plans or templates, each a link to its page (M7.2). */
export function PlansTable({
  plans,
  label,
  templates = false,
}: {
  plans: PlanSummary[];
  label: string;
  templates?: boolean;
}) {
  const t = useTranslations("workoutPlans");
  const columns: DataTableColumn<PlanSummary>[] = [
    {
      id: "name",
      header: t("fields.name"),
      cell: ({ row }) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/workouts/plans/${row.original.id}`}>
          {row.original.name}
        </Link>
      ),
    },
    ...(templates
      ? []
      : ([
          {
            id: "customer",
            header: t("fields.customer"),
            cell: ({ row }) =>
              row.original.customer ? `${row.original.customer.fullName} · ${row.original.customer.customerCode}` : "—",
          },
          { id: "trainer", header: t("fields.trainer"), cell: ({ row }) => row.original.trainer?.fullName ?? "—" },
          { id: "sessions", header: t("fields.sessions"), cell: ({ row }) => row.original.sessions },
        ] satisfies DataTableColumn<PlanSummary>[])),
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="plan" status={row.original.status} />,
    },
    {
      id: "updated",
      header: t("fields.updated"),
      cell: ({ row }) => <DateTime value={row.original.updatedAt} format="dateTime" />,
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={plans}
      label={label}
      empty={<EmptyState icon={ClipboardListIcon} title={t("empty")} />}
      getRowId={(row) => row.id}
    />
  );
}
