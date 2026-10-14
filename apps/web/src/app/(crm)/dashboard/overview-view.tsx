"use client";

import { useTranslations } from "next-intl";
import { BarChart } from "@/components/bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { DateTime } from "@/components/date-time";
import { ChartColumnIcon } from "lucide-react";
import type { Overview } from "@flow/shared/reports";

/** The overview dashboard (docs/10, A-172): the figures of a period and two charts, each with its table beside it. */
export function OverviewView({ overview }: { overview: Overview }) {
  const t = useTranslations("overview");

  const figures = [
    { key: "newLeads", value: overview.newLeads },
    {
      key: "conversionRate",
      value: `${overview.conversionRate}%`,
      hint: t("conversionHint", { count: overview.convertedLeads }),
    },
    { key: "membersTraining", value: overview.membersTraining },
    { key: "activePts", value: overview.activePts },
    {
      key: "endingSoon",
      value: overview.endingSoon,
      hint: t("endingSoonHint", { days: overview.expiringSoonDays, sessions: overview.runningOutSessions }),
    },
  ] as const;

  // Only the hours between the first and the last session are drawn, so the chart is not 24 rows of mostly nothing.
  const busy = overview.sessionsByHour.filter((entry) => entry.sessions > 0);
  const first = busy[0]?.hour ?? 0;
  const last = busy.at(-1)?.hour ?? -1;
  const hours = overview.sessionsByHour
    .filter((entry) => entry.hour >= first && entry.hour <= last)
    .map((entry) => ({ name: `${String(entry.hour).padStart(2, "0")}:00`, sessions: entry.sessions }));
  const months = overview.revenueByMonth?.map((entry) => ({
    name: `${entry.month.slice(5)}/${entry.month.slice(0, 4)}`,
    revenue: entry.revenue,
  }));

  const years = overview.revenueByYear?.map((entry) => ({ name: entry.year, revenue: entry.revenue }));

  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-muted-foreground">
        {t("period")}: <DateTime value={overview.from} /> – <DateTime value={overview.to} />
      </p>
      <section aria-label={t("figures")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {figures.map((entry) => (
          <Card key={entry.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{t(`fields.${entry.key}`)}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid={`overview-${entry.key}`}>
                {entry.value}
              </div>
              {"hint" in entry && <p className="mt-1 text-xs text-muted-foreground">{entry.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card role="region" aria-label={t("byHour")}>
          <CardHeader>
            <CardTitle>{t("byHour")}</CardTitle>
          </CardHeader>
          <CardContent>
            {hours.length === 0 ? (
              <EmptyState icon={ChartColumnIcon} title={t("noSessions")} />
            ) : (
              <BarChart
                data={hours}
                series={[{ key: "sessions", label: t("sessions"), color: "var(--chart-1)" }]}
                label={t("byHour")}
              />
            )}
          </CardContent>
        </Card>
        {months && (
          <Card role="region" aria-label={t("byMonth")}>
            <CardHeader>
              <CardTitle>{t("byMonth")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <BarChart
                data={months}
                series={[{ key: "revenue", label: t("revenue"), color: "var(--chart-2)" }]}
                label={t("byMonth")}
              />
              <p className="text-xs text-muted-foreground">
                {t("revenueTotal")}: <Money amount={months.reduce((sum, entry) => sum + entry.revenue, 0)} />
              </p>
            </CardContent>
          </Card>
        )}
        {years && (
          <Card role="region" aria-label={t("byYear")}>
            <CardHeader>
              <CardTitle>{t("byYear")}</CardTitle>
            </CardHeader>
            <CardContent>
              <BarChart
                data={years}
                series={[{ key: "revenue", label: t("revenue"), color: "var(--chart-3)" }]}
                label={t("byYear")}
              />
            </CardContent>
          </Card>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
