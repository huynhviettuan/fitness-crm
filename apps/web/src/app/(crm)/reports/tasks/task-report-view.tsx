"use client";

import { useLocale, useTranslations } from "next-intl";
import { ListChecksIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import type { TaskReport, TaskReportRow } from "@flow/shared/reports";

/** The tasks report (brief §9, FR-TASK-006): the tasks of the period by person and by department. */
export function TaskReportView({ report }: { report: TaskReport }) {
  const t = useTranslations("taskReport");
  const locale = useLocale();

  if (report.totals.assigned === 0) return <EmptyState icon={ListChecksIcon} title={t("empty")} />;

  const department = (row: TaskReportRow) =>
    row.department ? (locale === "vi" ? row.department.labelVi : row.department.labelEn) : "—";
  const counts: DataTableColumn<TaskReportRow>[] = [
    { id: "assigned", header: t("fields.assigned"), cell: ({ row }) => row.original.assigned },
    { id: "doneOnTime", header: t("fields.doneOnTime"), cell: ({ row }) => row.original.doneOnTime },
    { id: "doneLate", header: t("fields.doneLate"), cell: ({ row }) => row.original.doneLate },
    { id: "overdue", header: t("fields.overdue"), cell: ({ row }) => row.original.overdue },
    { id: "open", header: t("fields.open"), cell: ({ row }) => row.original.open },
    { id: "cancelled", header: t("fields.cancelled"), cell: ({ row }) => row.original.cancelled },
    { id: "onTimeRate", header: t("fields.onTimeRate"), cell: ({ row }) => `${row.original.onTimeRate}%` },
  ];
  const personColumns: DataTableColumn<TaskReportRow>[] = [
    {
      id: "person",
      header: t("fields.person"),
      cell: ({ row }) => <span className="font-medium">{row.original.user?.name}</span>,
    },
    { id: "department", header: t("fields.department"), cell: ({ row }) => department(row.original) },
    ...counts,
  ];
  const departmentColumns: DataTableColumn<TaskReportRow>[] = [
    {
      id: "department",
      header: t("fields.department"),
      cell: ({ row }) => <span className="font-medium">{department(row.original)}</span>,
    },
    ...counts,
  ];
  const totals = [
    { key: "assigned", value: report.totals.assigned },
    { key: "doneOnTime", value: report.totals.doneOnTime },
    { key: "doneLate", value: report.totals.doneLate },
    { key: "overdue", value: report.totals.overdue },
    { key: "onTimeRate", value: `${report.totals.onTimeRate}%` },
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("totals")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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
      <Card role="region" aria-label={t("byPerson")}>
        <CardHeader>
          <CardTitle>{t("byPerson")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={personColumns}
            data={report.byPerson}
            label={t("byPerson")}
            empty={null}
            getRowId={(row) => row.user?.id ?? ""}
          />
        </CardContent>
      </Card>
      <Card role="region" aria-label={t("byDepartment")}>
        <CardHeader>
          <CardTitle>{t("byDepartment")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={departmentColumns}
            data={report.byDepartment}
            label={t("byDepartment")}
            empty={null}
            getRowId={(row) => row.department?.id ?? ""}
          />
        </CardContent>
      </Card>
    </div>
  );
}
