"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "cn";

// The shadcn Chart (docs/23 §2): a container that gives Recharts its size and its colors as
// CSS variables, and a tooltip. Every chart sits next to a table with the same figures (A-094).

export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used inside a <ChartContainer />");
  return context;
}

function ChartContainer({
  config,
  className,
  children,
  label,
  height,
}: {
  config: ChartConfig;
  className?: string;
  /** A fixed height in pixels, for charts that grow with their rows. */
  height?: number;
  /** What the chart shows, for people who cannot see it. */
  label: string;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const style = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]));
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        role="img"
        aria-label={label}
        data-slot="chart"
        style={{ ...style, ...(height ? { height } : {}) } as React.CSSProperties}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;
const ChartLegend = RechartsPrimitive.Legend;

type TooltipPayload = { dataKey?: string | number; name?: string | number; value?: number | string; color?: string };

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
}) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-32 gap-1.5 rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-xl">
      {label !== undefined && <div className="font-medium">{label}</div>}
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name);
        return (
          <div key={key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
              {config[key]?.label ?? key}
            </span>
            <span className="font-mono font-medium tabular-nums">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

type LegendPayload = { dataKey?: string | number; value?: string | number; color?: string };

/** The legend with the labels of the chart's config; Recharts' own would show the field names. */
function ChartLegendContent({ payload }: { payload?: LegendPayload[] }) {
  const { config } = useChart();
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.value);
        return (
          <div key={key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {config[key]?.label ?? key}
          </div>
        );
      })}
    </div>
  );
}

export { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent };
