"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ChosenOptionText } from "@/components/option-select";
import { StatusBadge } from "@/components/status-badge";
import type { Employee } from "@flow/shared/employees";

type EmployeesTableProps = {
  employees: Employee[];
  empty: React.ReactNode;
  footer?: React.ReactNode;
};

/** The employee list (brief §8.4); a row's code opens the employee. */
export function EmployeesTable({ employees, empty, footer }: EmployeesTableProps) {
  const t = useTranslations("employees");

  const columns: DataTableColumn<Employee>[] = [
    {
      id: "employeeCode",
      header: t("fields.employeeCode"),
      cell: ({ row }) => (
        <Link
          href={`/employees/${row.original.id}`}
          aria-label={t("open", { name: row.original.fullName })}
          className="font-mono text-sm underline-offset-4 hover:underline"
        >
          {row.original.employeeCode}
        </Link>
      ),
    },
    {
      id: "fullName",
      header: t("fields.fullName"),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          {row.original.fullName}
          {row.original.isTrainer && <Badge variant="outline">{t("trainer")}</Badge>}
        </span>
      ),
    },
    {
      id: "department",
      header: t("fields.department"),
      cell: ({ row }) => (row.original.department ? <ChosenOptionText option={row.original.department} /> : null),
    },
    {
      id: "title",
      header: t("fields.title"),
      cell: ({ row }) => (row.original.title ? <ChosenOptionText option={row.original.title} /> : null),
    },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    { id: "phone", header: t("fields.phone"), cell: ({ row }) => <span className="tabular-nums">{row.original.phone}</span> },
    {
      id: "login",
      header: t("fields.login"),
      cell: ({ row }) => row.original.user?.email ?? <span className="text-muted-foreground">{t("noLogin")}</span>,
    },
    { id: "status", header: t("fields.status"), cell: ({ row }) => <StatusBadge entity="employee" status={row.original.status} /> },
  ];

  return <DataTable columns={columns} data={employees} label={t("title")} empty={empty} getRowId={(row) => row.id} footer={footer} />;
}
