"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChartNoAxesColumnIcon } from "lucide-react";
import { BarChart } from "@/components/bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { optionLabel } from "@/components/option-select";
import { countryName } from "@flow/shared/countries";
import type { AnalysisBucket, LeadAnalysis } from "@flow/shared/leads";

const rate = (value: number | null) => (value === null ? "—" : `${value}%`);

/** The cohort split by each dimension: a chart and the same figures in a table, with the notes of "Khác" (A-092, A-094). */
export function LeadAnalysisView({ analysis }: { analysis: LeadAnalysis }) {
  const t = useTranslations("leadAnalysis");
  const locale = useLocale();

  const label = (bucket: AnalysisBucket, dimension: string) => {
    if (bucket.option) return optionLabel(bucket.option, locale);
    if (bucket.value && dimension === "country") return countryName(bucket.value, locale);
    if (bucket.value) return t(`values.${bucket.value}` as Parameters<typeof t>[0]);
    return t("notGiven");
  };

  if (analysis.total === 0) {
    return <EmptyState icon={ChartNoAxesColumnIcon} title={t("empty")} />;
  }

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-muted-foreground">{t("total", { count: analysis.total })}</p>
      {analysis.dimensions.map(({ dimension, buckets }) => {
        if (buckets.length === 0) return null;
        const columns: DataTableColumn<AnalysisBucket>[] = [
          {
            id: "bucket",
            header: t(`dimensions.${dimension}`),
            cell: ({ row }) => (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{label(row.original, dimension)}</span>
                {row.original.notes.length > 0 && (
                  <span className="text-xs whitespace-normal text-muted-foreground">
                    {row.original.notes.map((entry) => `${entry.note} (${entry.count})`).join(" · ")}
                  </span>
                )}
              </span>
            ),
          },
          { id: "leads", header: t("fields.leads"), cell: ({ row }) => row.original.leads },
          { id: "booked", header: t("fields.booked"), cell: ({ row }) => row.original.booked },
          { id: "showed", header: t("fields.showed"), cell: ({ row }) => row.original.showed },
          { id: "contracted", header: t("fields.contracted"), cell: ({ row }) => row.original.contracted },
          { id: "bookingRate", header: t("fields.bookingRate"), cell: ({ row }) => rate(row.original.bookingRate) },
          { id: "showRate", header: t("fields.showRate"), cell: ({ row }) => rate(row.original.showRate) },
        ];
        return (
          <Card key={dimension} role="region" aria-label={t(`dimensions.${dimension}`)}>
            <CardHeader>
              <CardTitle>{t(`dimensions.${dimension}`)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <BarChart
                data={buckets.map((bucket) => ({
                  name: label(bucket, dimension),
                  leads: bucket.leads,
                  booked: bucket.booked,
                  showed: bucket.showed,
                }))}
                series={[
                  { key: "leads", label: t("fields.leads"), color: "var(--chart-1)" },
                  { key: "booked", label: t("fields.booked"), color: "var(--chart-3)" },
                  { key: "showed", label: t("fields.showed"), color: "var(--chart-2)" },
                ]}
                label={t("chartLabel", { dimension: t(`dimensions.${dimension}`) })}
                className="aspect-auto h-64 w-full"
              />
              <DataTable
                columns={columns}
                data={buckets}
                label={t(`dimensions.${dimension}`)}
                empty={null}
                getRowId={(bucket) => bucket.option?.id ?? bucket.value ?? "none"}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
