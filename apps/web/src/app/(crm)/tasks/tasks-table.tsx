"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { StatusBadge } from "@/components/status-badge";
import type { Task } from "@gymcrm/shared/tasks";

type TasksTableProps = { tasks: Task[]; label: string; empty: React.ReactNode; footer?: React.ReactNode };

/** A list of tasks (brief §8.2); overdue ones are marked (FR-TASK-005). */
export function TasksTable({ tasks, label, empty, footer }: TasksTableProps) {
  const t = useTranslations("tasks");
  const locale = useLocale();

  const columns: DataTableColumn<Task>[] = [
    {
      id: "title",
      header: t("fields.title"),
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <Link
            href={`/tasks/${row.original.id}`}
            aria-label={t("open", { title: row.original.title })}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.title}
          </Link>
          {row.original.entity && <span className="text-xs text-muted-foreground">{row.original.entity.label}</span>}
        </span>
      ),
    },
    {
      id: "assignee",
      header: t("fields.assignee"),
      cell: ({ row }) => {
        const { assignee, department } = row.original;
        const departmentName = department ? (locale === "vi" ? department.labelVi : department.labelEn) : null;
        if (assignee) return departmentName ? `${assignee.name} · ${departmentName}` : assignee.name;
        return (
          <span>
            {departmentName} <span className="text-muted-foreground">· {t("waitingInDepartment")}</span>
          </span>
        );
      },
    },
    { id: "assigner", header: t("fields.assigner"), cell: ({ row }) => row.original.assigner.name },
    {
      id: "dueAt",
      header: t("fields.dueAt"),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2 tabular-nums">
          <DateTime value={row.original.dueAt} format="dateTime" />
          {row.original.overdue && <Badge variant="destructive">{t("overdue")}</Badge>}
        </span>
      ),
    },
    {
      id: "priority",
      header: t("fields.priority"),
      cell: ({ row }) => <StatusBadge entity="taskPriority" status={row.original.priority} />,
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="task" status={row.original.status} />,
    },
  ];

  return (
    <DataTable columns={columns} data={tasks} label={label} empty={empty} getRowId={(row) => row.id} footer={footer} />
  );
}
