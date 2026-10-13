"use client";

import { useLocale, useTranslations } from "next-intl";
import { BookOpenIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { optionLabel } from "@/components/option-select";
import type { CashBook, CashBookDay, CashBookRow } from "@flow/shared/finance";

const FIGURES = ["opening", "inflow", "outflow", "closing"] as const;
type Figures = Record<(typeof FIGURES)[number], number>;

function figureColumns<Row extends Figures>(header: (key: (typeof FIGURES)[number]) => string): DataTableColumn<Row>[] {
  return FIGURES.map((key) => ({
    id: key,
    header: header(key),
    cell: ({ row }) => <Money amount={row.original[key]} />,
  }));
}

/** The cash book of a period (FR-CASH-005, AC-19): per branch and method, then day by day. Closing = opening + in − out. */
export function CashBookView({ book }: { book: CashBook }) {
  const t = useTranslations("cashBook");
  const locale = useLocale();

  if (book.rows.length === 0 && book.totals.inflow === 0 && book.totals.outflow === 0) {
    return <EmptyState icon={BookOpenIcon} title={t("empty")} />;
  }

  const rowColumns: DataTableColumn<CashBookRow>[] = [
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    { id: "method", header: t("fields.method"), cell: ({ row }) => optionLabel(row.original.method, locale) },
    ...figureColumns<CashBookRow>((key) => t(`fields.${key}`)),
  ];
  const dayColumns: DataTableColumn<CashBookDay>[] = [
    { id: "day", header: t("fields.day"), cell: ({ row }) => <DateTime value={row.original.day} format="dateOnly" /> },
    ...figureColumns<CashBookDay>((key) => t(`fields.${key}`)),
  ];

  const totals = [
    { key: "opening", amount: book.totals.opening },
    { key: "inflow", amount: book.totals.inflow },
    { key: "outflow", amount: book.totals.outflow },
    { key: "closing", amount: book.totals.closing },
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("totals")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {totals.map(({ key, amount }) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{t(`fields.${key}`)}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              <Money amount={amount} />
            </CardContent>
          </Card>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      <Card role="region" aria-label={t("byMethod")}>
        <CardHeader>
          <CardTitle>{t("byMethod")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={rowColumns}
            data={book.rows}
            label={t("byMethod")}
            empty={null}
            getRowId={(row) => `${row.branch.id}:${row.method.id}`}
          />
        </CardContent>
      </Card>
      <Card role="region" aria-label={t("byDay")}>
        <CardHeader>
          <CardTitle>{t("byDay")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={dayColumns}
            data={book.days}
            label={t("byDay")}
            empty={null}
            getRowId={(row) => row.day.toISOString()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
