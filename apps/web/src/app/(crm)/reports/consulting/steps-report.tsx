"use client";

import { useLocale, useTranslations } from "next-intl";
import { ListChecksIcon } from "lucide-react";
import { BarChart } from "@/components/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import type { ConsultingReport } from "@flow/shared/leads";

type StepRow = ConsultingReport["steps"][number];

const rate = (value: number | null) => (value === null ? "—" : `${value}%`);
/** "did | did not", e.g. "60% | 40%": what became of those who did the step and of those who did not (D-055). */
const pair = (did: number | null, didNot: number | null) => `${rate(did)} | ${rate(didNot)}`;

/**
 * How often each step of the checklist is done, and how those who did it fare against those who did
 * not (D-055): the checklist measures the process, not the people, so the owner can see which steps
 * are redundant and which are missing. The chart and the table hold the same figures (A-094).
 */
export function StepsReport({ steps }: { steps: StepRow[] }) {
  const t = useTranslations("consultingReport.steps");
  const locale = useLocale();
  const name = (step: StepRow) => (locale === "vi" ? step.labelVi : step.labelEn);

  const columns: DataTableColumn<StepRow>[] = [
    { id: "step", header: t("step"), cell: ({ row }) => <span className="font-medium">{name(row.original)}</span> },
    { id: "due", header: t("due"), cell: ({ row }) => row.original.due },
    { id: "done", header: t("done"), cell: ({ row }) => row.original.done },
    { id: "late", header: t("late"), cell: ({ row }) => row.original.late },
    { id: "notDone", header: t("notDone"), cell: ({ row }) => row.original.notDone },
    { id: "completion", header: t("completion"), cell: ({ row }) => rate(row.original.completionRate) },
    {
      id: "booking",
      header: t("booking"),
      cell: ({ row }) => pair(row.original.did.bookingRate, row.original.didNot.bookingRate),
    },
    {
      id: "show",
      header: t("show"),
      cell: ({ row }) => pair(row.original.did.showRate, row.original.didNot.showRate),
    },
    {
      id: "contract",
      header: t("contract"),
      cell: ({ row }) => pair(row.original.did.contractRate, row.original.didNot.contractRate),
    },
  ];

  return (
    <section aria-labelledby="steps-report" className="space-y-3">
      <div>
        <h2 id="steps-report" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {steps.length === 0 ? (
        <EmptyState icon={ListChecksIcon} title={t("empty")} />
      ) : (
        <>
          <Card role="region" aria-label={t("chart")}>
            <CardHeader>
              <CardTitle>{t("chart")}</CardTitle>
              <CardDescription>{t("chartHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart
                data={steps.map((step) => ({ name: name(step), completion: step.completionRate }))}
                series={[{ key: "completion", label: t("completion"), color: "var(--chart-2)" }]}
                label={t("chartLabel")}
                className="aspect-auto h-80 w-full"
              />
            </CardContent>
          </Card>
          <DataTable
            columns={columns}
            data={steps}
            label={t("title")}
            empty={<EmptyState icon={ListChecksIcon} title={t("empty")} />}
            getRowId={(step) => step.key}
          />
        </>
      )}
    </section>
  );
}
