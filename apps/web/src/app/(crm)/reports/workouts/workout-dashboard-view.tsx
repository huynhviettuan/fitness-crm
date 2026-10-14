"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ActivityIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { ChosenOptionText } from "@/components/option-select";
import { TablePagination } from "@/components/table-pagination";
import type { SearchParams } from "@/lib/paging";
import type { DashboardKind, WorkoutDashboard, WorkoutDrill, WorkoutDrillRow } from "@flow/shared/workouts";

type Share = WorkoutDashboard["flags"][number];

/** The weekly workout dashboard (brief §9): figures first, then the sets behind the share that was opened. */
export function WorkoutDashboardView({
  dashboard,
  drill,
  drillKind,
  drillOption,
  params,
  filters,
}: {
  dashboard: WorkoutDashboard;
  drill: WorkoutDrill | null;
  drillKind: DashboardKind | undefined;
  drillOption: string | undefined;
  params: SearchParams;
  filters: { week: string | undefined; branch: string | undefined };
}) {
  const t = useTranslations("workoutDashboard");
  const locale = useLocale();

  /** A link to this screen with the share to open, keeping the week and the branch. */
  const drillHref = (kind: DashboardKind, optionId?: string) => {
    const query = new URLSearchParams();
    if (filters.week) query.set("week", filters.week);
    if (filters.branch) query.set("branch", filters.branch);
    query.set("kind", kind);
    if (optionId) query.set("option", optionId);
    return `/reports/workouts?${query.toString()}`;
  };

  const change = (now: number, before: number) => {
    const delta = Math.round((now - before) * 10) / 10;
    return delta > 0 ? `+${delta}` : String(delta);
  };

  const sharesTable = (title: string, kind: "flag" | "action", rows: Share[]) => (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.option")}</TableHead>
              <TableHead className="text-right">{t("fields.sets")}</TableHead>
              <TableHead className="text-right">{t("fields.percent")}</TableHead>
              <TableHead className="text-right">{t("fields.previousPercent")}</TableHead>
              <TableHead className="text-right">{t("fields.change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.option.id} data-state={drillOption === row.option.id ? "selected" : undefined}>
                <TableCell>{locale === "vi" ? row.option.labelVi : row.option.labelEn}</TableCell>
                <TableCell className="text-right tabular-nums">{row.sets}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.sets > 0 ? (
                    <Link className="underline underline-offset-4" href={drillHref(kind, row.option.id)}>
                      {t("percentValue", { value: row.percent })}
                    </Link>
                  ) : (
                    t("percentValue", { value: row.percent })
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {t("percentValue", { value: row.previousPercent })}
                </TableCell>
                <TableCell className="text-right tabular-nums">{change(row.percent, row.previousPercent)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  const columns: DataTableColumn<WorkoutDrillRow>[] = [
    {
      id: "date",
      header: t("fields.session"),
      cell: ({ row }) => (
        <Link className="font-medium underline-offset-4 hover:underline" href={`/workouts/logs/${row.original.logId}`}>
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
    {
      id: "exercise",
      header: t("fields.exercise"),
      cell: ({ row }) => t("exerciseSet", { exercise: row.original.exercise, set: row.original.setNo }),
    },
    { id: "flag", header: t("fields.flag"), cell: ({ row }) => <ChosenOptionText option={row.original.flag} /> },
    { id: "action", header: t("fields.action"), cell: ({ row }) => <ChosenOptionText option={row.original.action} /> },
    { id: "note", header: t("fields.note"), cell: ({ row }) => row.original.note ?? "—" },
  ];

  const figure = (label: string, value: number, previous: number, href?: string) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {href && value > 0 ? (
            <Link className="underline underline-offset-4" href={href}>
              {value}
            </Link>
          ) : (
            value
          )}
        </p>
        <p className="text-xs text-muted-foreground">{t("previous", { value: previous })}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-muted-foreground">
        {t("weekOf")}: <DateTime value={dashboard.week.from} format="dateOnly" /> –{" "}
        <DateTime value={dashboard.week.to} format="dateOnly" />
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {figure(t("totals.sets"), dashboard.totals.sets, dashboard.totals.previousSets)}
        {figure(t("totals.sessions"), dashboard.totals.sessions, dashboard.totals.previousSessions)}
        {figure(
          t("totals.nonNormal"),
          dashboard.nonNormalCustomers,
          dashboard.previousNonNormalCustomers,
          drillHref("nonNormal"),
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("totals.escalations")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              <Link className="underline underline-offset-4" href="/workouts/escalations?status=WAITING">
                {dashboard.openEscalations}
              </Link>
            </p>
            <p className="text-xs text-muted-foreground">{t("escalationsHint")}</p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {sharesTable(t("flags"), "flag", dashboard.flags)}
        {sharesTable(t("actions"), "action", dashboard.actions)}
      </div>
      {drill && drillKind && (
        <section className="space-y-3" aria-label={t("drill")}>
          <h2 className="text-lg font-medium">{t("drill")}</h2>
          <DataTable
            columns={columns}
            data={drill.items}
            label={t("drill")}
            empty={<EmptyState icon={ActivityIcon} title={t("empty")} />}
            getRowId={(row) => `${row.logId}-${row.exercise}-${row.setNo}`}
          />
          <TablePagination
            page={drill.page}
            pageSize={drill.pageSize}
            total={drill.total}
            path="/reports/workouts"
            params={params}
          />
        </section>
      )}
    </div>
  );
}
