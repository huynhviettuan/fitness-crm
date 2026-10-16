"use client";

import { Bar, BarChart as RechartsBarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type BarChartProps = {
  /** One row per bar group, e.g. a funnel stage or a channel. */
  data: ({ name: string } & Record<string, string | number | null>)[];
  /** The bars of each group, in order; `key` is a field of the rows. */
  series: { key: string; label: string; color: string }[];
  /** What the chart shows, for people who cannot see it; the same figures are in the table beside it (A-094). */
  label: string;
  /** Gives each group its own chart color instead of one color per series, for a single series such as a funnel. */
  colorByGroup?: boolean;
  className?: string;
};

const GROUP_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** The shared chart of the dashboards (docs/23 §8): horizontal grouped bars on the theme's chart colors. */
export function BarChart({ data, series, label, colorByGroup, className }: BarChartProps) {
  const config: ChartConfig = Object.fromEntries(
    series.map(({ key, label: text, color }) => [key, { label: text, color }]),
  );
  // A grouped chart grows with its groups so every label and bar stays readable.
  const height = series.length > 1 ? Math.max(256, data.length * (series.length * 12 + 16) + 56) : undefined;
  return (
    <ChartContainer config={config} label={label} className={className ?? "aspect-auto h-64 w-full"} height={height}>
      <RechartsBarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={110} interval={0} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {series.map(({ key }) => (
          <Bar key={key} dataKey={key} fill={`var(--color-${key})`} radius={3} isAnimationActive={false}>
            {colorByGroup &&
              data.map((row, index) => <Cell key={row.name} fill={GROUP_COLORS[index % GROUP_COLORS.length]} />)}
          </Bar>
        ))}
      </RechartsBarChart>
    </ChartContainer>
  );
}
