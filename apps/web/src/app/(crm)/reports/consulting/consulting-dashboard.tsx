"use client";

import { useTranslations } from "next-intl";
import { ClipboardCheckIcon } from "lucide-react";
import { BarChart } from "@/components/bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StepsReport } from "./steps-report";
import type { ConsultingReport, ConsultingReportRow } from "@flow/shared/leads";

type Line = { team: boolean; row: ConsultingReportRow };

/** A percentage or minutes figure, or a dash when there was nothing to measure. */
function Figure({ value, unit }: { value: number | null; unit?: "percent" | "minutes" }) {
  const t = useTranslations("consultingReport");
  if (value === null) return <span className="text-muted-foreground">{t("noData")}</span>;
  return <>{unit === "minutes" ? t("minutes", { count: value }) : unit === "percent" ? `${value}%` : value}</>;
}

/** The team's KPIs, its funnel as a chart, and every consultant's figures in a table (A-089 to A-094). */
export function ConsultingDashboard({ report }: { report: ConsultingReport }) {
  const t = useTranslations("consultingReport");
  const { team } = report;

  const kpis: [string, React.ReactNode][] = [
    [t("fields.leads"), team.leads],
    [t("fields.bookingRate"), <Figure key="b" value={team.bookingRate} unit="percent" />],
    [t("fields.showRate"), <Figure key="s" value={team.showRate} unit="percent" />],
    [t("fields.compliance"), <Figure key="c" value={team.compliance} unit="percent" />],
    [t("fields.firstResponse"), <Figure key="f" value={team.firstResponseMinutes} unit="minutes" />],
    [t("fields.score"), <Figure key="a" value={team.score} unit="percent" />],
  ];
  const funnel = [
    { name: t("funnel.leads"), count: team.leads },
    { name: t("funnel.consulted"), count: team.consulted },
    { name: t("funnel.booked"), count: team.booked },
    { name: t("funnel.showed"), count: team.showed },
    { name: t("funnel.contracted"), count: team.contracted },
  ];

  const lines: Line[] =
    report.items.length === 0
      ? []
      : [...report.items.map((row) => ({ team: false, row })), { team: true, row: { consultant: null, ...team } }];
  const columns: DataTableColumn<Line>[] = [
    {
      id: "consultant",
      header: t("fields.consultant"),
      cell: ({ row }) =>
        row.original.team ? (
          <span className="font-semibold">{t("team")}</span>
        ) : (
          <span className="font-medium">{row.original.row.consultant?.name ?? t("noConsultant")}</span>
        ),
    },
    { id: "leads", header: t("fields.leads"), cell: ({ row }) => row.original.row.leads },
    { id: "consulted", header: t("funnel.consulted"), cell: ({ row }) => row.original.row.consulted },
    { id: "booked", header: t("funnel.booked"), cell: ({ row }) => row.original.row.booked },
    { id: "showed", header: t("funnel.showed"), cell: ({ row }) => row.original.row.showed },
    { id: "contracted", header: t("funnel.contracted"), cell: ({ row }) => row.original.row.contracted },
    {
      id: "bookingRate",
      header: t("fields.bookingRate"),
      cell: ({ row }) => <Figure value={row.original.row.bookingRate} unit="percent" />,
    },
    {
      id: "showRate",
      header: t("fields.showRate"),
      cell: ({ row }) => <Figure value={row.original.row.showRate} unit="percent" />,
    },
    {
      id: "compliance",
      header: t("fields.compliance"),
      cell: ({ row }) => <Figure value={row.original.row.compliance} unit="percent" />,
    },
    {
      id: "firstResponse",
      header: t("fields.firstResponse"),
      cell: ({ row }) => <Figure value={row.original.row.firstResponseMinutes} unit="minutes" />,
    },
    {
      id: "recare",
      header: t("fields.recare"),
      cell: ({ row }) =>
        row.original.row.recareEntered === 0 ? (
          <Figure value={null} />
        ) : (
          t("recareValue", { entered: row.original.row.recareEntered, rebooked: row.original.row.recareRebooked })
        ),
    },
    {
      id: "reclaimed",
      header: t("fields.reclaimed"),
      cell: ({ row }) => row.original.row.reclaimed,
    },
    {
      id: "score",
      header: t("fields.score"),
      cell: ({ row }) => <Figure value={row.original.row.score} unit="percent" />,
    },
  ];

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("kpis")}>
        <dl className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map(([label, value]) => (
            <Card key={label}>
              <CardContent className="space-y-1 pt-4">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
              </CardContent>
            </Card>
          ))}
        </dl>
      </section>
      <Card role="region" aria-label={t("funnel.title")}>
        <CardHeader>
          <CardTitle>{t("funnel.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChart
            data={funnel}
            series={[{ key: "count", label: t("fields.leads"), color: "var(--chart-1)" }]}
            colorByGroup
            label={t("funnel.chartLabel")}
            className="aspect-auto h-56 w-full"
          />
        </CardContent>
      </Card>
      <section aria-labelledby="consulting-table" className="space-y-3">
        <h2 id="consulting-table" className="text-lg font-semibold">
          {t("byConsultant")}
        </h2>
        <DataTable
          columns={columns}
          data={lines}
          label={t("byConsultant")}
          empty={<EmptyState icon={ClipboardCheckIcon} title={t("empty")} />}
          getRowId={(line) => (line.team ? "team" : (line.row.consultant?.id ?? "none"))}
        />
      </section>
      <StepsReport steps={report.steps} />
    </div>
  );
}
