"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { HandCoinsIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { formatDateOnly } from "@/lib/format";
import { PayoutButton } from "./payout-dialog";
import type { PtRevenueReport, PtRevenueRow, PtRevenueTrainer } from "@gymcrm/shared/reports";

/** The PT revenue allocation (brief §6.5, D-032): GymMaster's columns, a table per PT with that PT's totals. */
export function PtRevenueView({ report, canPay }: { report: PtRevenueReport; canPay: boolean }) {
  const t = useTranslations("ptRevenue");

  if (report.trainers.length === 0) return <EmptyState icon={HandCoinsIcon} title={t("empty")} />;

  const columns: DataTableColumn<PtRevenueRow>[] = [
    {
      id: "member",
      header: t("fields.member"),
      cell: ({ row }) => (
        <div className="min-w-40">
          <div className="font-medium">{row.original.customer.fullName}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.customer.customerCode} · {row.original.customer.phone ?? <HiddenValue />}
          </div>
        </div>
      ),
    },
    {
      id: "contract",
      header: t("fields.contract"),
      cell: ({ row }) => (
        <div className="min-w-32">
          <div>{row.original.contract.contractCode}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.contract.service?.name ?? t("noService")} · {row.original.branch.name}
          </div>
        </div>
      ),
    },
    {
      id: "value",
      header: t("fields.value"),
      cell: ({ row }) => <Money amount={row.original.contract.contractValue} />,
    },
    {
      id: "allocationValue",
      header: t("fields.allocationValue"),
      cell: ({ row }) => <Money amount={row.original.allocationValue} />,
    },
    { id: "sessions", header: t("fields.sessions"), cell: ({ row }) => row.original.sessions },
    {
      id: "perSession",
      header: t("fields.perSession"),
      cell: ({ row }) => <Money amount={row.original.allocationPerSession} />,
    },
    { id: "credited", header: t("fields.credited"), cell: ({ row }) => row.original.credited },
    {
      id: "shift",
      header: t("fields.shift"),
      cell: ({ row }) => t("shiftValue", { inside: row.original.inShift, outside: row.original.outsideShift }),
    },
    {
      id: "rates",
      header: t("fields.rates"),
      cell: ({ row }) =>
        t("ratesValue", { commission: row.original.commissionRate, timesheet: row.original.timesheetRate }),
    },
    {
      id: "allocation",
      header: t("fields.allocation"),
      cell: ({ row }) => <Money amount={row.original.allocation} />,
    },
    {
      id: "adjustments",
      header: t("fields.adjustments"),
      cell: ({ row }) => <Money amount={row.original.adjustments} />,
    },
    { id: "paid", header: t("fields.paid"), cell: ({ row }) => row.original.paidSessions },
    { id: "payable", header: t("fields.payable"), cell: ({ row }) => <Money amount={row.original.payable} /> },
    { id: "note", header: t("fields.note"), cell: ({ row }) => row.original.contract.note ?? "—" },
  ];

  const totals = [
    { key: "credited", value: report.totals.credited, money: false },
    { key: "classSessions", value: report.totals.classSessions, money: false },
    { key: "allocation", value: report.totals.allocation, money: true },
    { key: "adjustments", value: report.totals.adjustments, money: true },
    { key: "payable", value: report.totals.payable, money: true },
  ] as const;
  const period = { from: formatDateOnly(report.from), to: formatDateOnly(report.to) };

  return (
    <div className="min-w-0 space-y-6">
      <section aria-label={t("totals")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {totals.map((entry) => (
          <Card key={entry.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                <h3>{t(`totalsOf.${entry.key}`)}</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {entry.money ? <Money amount={entry.value} /> : entry.value}
            </CardContent>
          </Card>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
      {report.trainers.map((trainer) => (
        <TrainerCard key={trainer.employee.id} trainer={trainer} columns={columns} canPay={canPay} period={period} />
      ))}
    </div>
  );
}

function TrainerCard({
  trainer,
  columns,
  canPay,
  period,
}: {
  trainer: PtRevenueTrainer;
  columns: DataTableColumn<PtRevenueRow>[];
  canPay: boolean;
  period: { from: string; to: string };
}) {
  const t = useTranslations("ptRevenue");
  const label = `${trainer.employee.fullName} (${trainer.employee.employeeCode})`;
  return (
    <Card role="region" aria-label={label}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{label}</CardTitle>
          {canPay && <PayoutButton trainer={trainer.employee} period={period} payable={trainer.payable} />}
        </div>
        <dl
          aria-label={t("trainerTotals", { name: trainer.employee.fullName })}
          className="flex flex-wrap gap-x-6 gap-y-1 text-sm"
        >
          <Figure label={t("totalsOf.credited")}>{trainer.credited}</Figure>
          <Figure label={t("fields.shift")}>
            {t("shiftValue", { inside: trainer.inShift, outside: trainer.outsideShift })}
          </Figure>
          <Figure label={t("totalsOf.classSessions")}>{trainer.classSessions}</Figure>
          <Figure label={t("totalsOf.allocation")}>
            <Money amount={trainer.allocation} />
          </Figure>
          <Figure label={t("totalsOf.adjustments")}>
            <Money amount={trainer.adjustments} />
          </Figure>
          <Figure label={t("totalsOf.payable")}>
            <Money amount={trainer.payable} />
          </Figure>
        </dl>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={trainer.rows}
          label={label}
          empty={<p className="text-sm text-muted-foreground">{t("noRows")}</p>}
          getRowId={(row) => row.contract.id}
        />
      </CardContent>
    </Card>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
