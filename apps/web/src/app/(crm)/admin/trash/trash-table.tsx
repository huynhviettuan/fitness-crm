"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { ChosenOptionText } from "@/components/option-select";
import type { ChosenOption } from "@flow/shared/options";
import type { TrashEntry } from "@flow/shared/trash";

/** Deleted records, newest first (FR-TRASH-002). "View" shows the record as it was. */
export function TrashTable({
  entries,
  empty,
  footer,
}: {
  entries: TrashEntry[];
  empty: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("trash");
  const [viewing, setViewing] = useState<TrashEntry | null>(null);

  const columns: DataTableColumn<TrashEntry>[] = [
    {
      id: "deletedAt",
      header: t("fields.deletedAt"),
      cell: ({ row }) => <DateTime value={row.original.deletedAt} format="dateTime" />,
    },
    { id: "type", header: t("fields.type"), cell: ({ row }) => t(`types.${row.original.entityType}`) },
    {
      id: "record",
      header: t("fields.record"),
      cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
    },
    {
      id: "amount",
      header: t("fields.amount"),
      cell: ({ row }) => (row.original.amount === null ? <HiddenValue /> : <Money amount={row.original.amount} />),
    },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    { id: "deletedBy", header: t("fields.deletedBy"), cell: ({ row }) => row.original.deletedBy },
    {
      id: "reason",
      header: t("fields.reason"),
      cell: ({ row }) => (
        <span className="max-w-64 whitespace-normal">
          <ChosenOptionText option={row.original.reason} />
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("view")}</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setViewing(row.original)}
          aria-label={t("viewLabel", { name: row.original.title })}
        >
          <EyeIcon />
          {t("view")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={entries}
        label={t("title")}
        empty={empty}
        footer={footer}
        getRowId={(row) => row.id}
      />
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        {viewing && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("detailTitle", { type: t(`types.${viewing.entityType}`) })}</DialogTitle>
              <DialogDescription>{t("detailDescription")}</DialogDescription>
            </DialogHeader>
            <TrashSnapshot entry={viewing} />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

type Snapshot = Record<string, unknown>;

/** The deleted record's fields, laid out per kind of record. */
function TrashSnapshot({ entry }: { entry: TrashEntry }) {
  const t = useTranslations();
  const s = entry.snapshot as Snapshot;
  const f = (key: string) => t(`finance.fields.${key}` as Parameters<typeof t>[0]);
  const money = typeof s.amount === "number" ? <Money amount={s.amount} /> : <HiddenValue />;
  const day = (value: unknown) => (typeof value === "string" ? <DateTime value={value} format="dateOnly" /> : null);
  const option = (value: unknown) => (value ? <ChosenOptionText option={value as ChosenOption} /> : null);
  const text = (value: unknown) => (typeof value === "string" ? value : null);

  const rows: [string, ReactNode][] =
    entry.entityType === "payment"
      ? [
          [f("contract"), text((s.contract as Snapshot | undefined)?.contractCode)],
          [f("customer"), text((s.customer as Snapshot | undefined)?.fullName)],
          [f("amount"), money],
          [f("method"), option(s.method)],
          [f("paidOn"), day(s.paidOn)],
          [f("createdBy"), text(s.createdBy)],
        ]
      : [
          [f("type"), s.type === "INCOME" || s.type === "EXPENSE" ? t(`finance.types.${s.type}`) : null],
          [f("category"), option(s.category)],
          [f("amount"), money],
          [f("occurredOn"), day(s.occurredOn)],
          [f("reference"), text(s.reference)],
          [f("description"), text(s.description)],
          [f("createdBy"), text(s.createdBy)],
        ];

  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value ?? "—"}</dd>
        </div>
      ))}
      <dt className="text-muted-foreground">{t("trash.fields.reason")}</dt>
      <dd className="min-w-0 break-words">
        <ChosenOptionText option={entry.reason} />
      </dd>
    </dl>
  );
}
