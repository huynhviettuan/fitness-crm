"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { StatusBadge } from "@/components/status-badge";
import type { ConsultantAudit, LeadToCheck, UnauditedLead } from "@flow/shared/leads";

type ConsultantRow = ConsultantAudit["items"][number];

/** A percentage, or a dash when there was nothing to measure. */
export function Percent({ value }: { value: number | null }) {
  const t = useTranslations("leadAudit");
  return value === null ? <span className="text-muted-foreground">{t("noData")}</span> : <>{value}%</>;
}

/** Each consultant's figures and the team's last (A-082). */
export function ConsultantsTable({
  rows,
  team,
  empty,
}: {
  rows: ConsultantRow[];
  team: ConsultantAudit["team"];
  empty: React.ReactNode;
}) {
  const t = useTranslations("leadAudit");
  const number = (row: { leads: number } & Pick<ConsultantRow, "due" | "onTime" | "late" | "skipped">) => ({
    leads: row.leads,
    due: row.due,
    onTime: row.onTime,
    late: row.late,
    skipped: row.skipped,
  });
  const data = rows.length === 0 ? [] : [...rows, { consultant: null, team: true as const, toCheck: null, ...team }];

  type Line = (typeof data)[number];
  const isTeam = (line: Line) => "team" in line;
  const columns: DataTableColumn<Line>[] = [
    {
      id: "consultant",
      header: t("consultant"),
      cell: ({ row }) =>
        isTeam(row.original) ? (
          <span className="font-semibold">{t("team")}</span>
        ) : (
          <span className="font-medium">{row.original.consultant?.name ?? t("noConsultant")}</span>
        ),
    },
    { id: "leads", header: t("fields.leads"), cell: ({ row }) => number(row.original).leads },
    { id: "due", header: t("fields.due"), cell: ({ row }) => number(row.original).due },
    { id: "onTime", header: t("fields.onTime"), cell: ({ row }) => number(row.original).onTime },
    { id: "late", header: t("fields.late"), cell: ({ row }) => number(row.original).late },
    { id: "skipped", header: t("fields.skipped"), cell: ({ row }) => number(row.original).skipped },
    {
      id: "compliance",
      header: t("fields.compliance"),
      cell: ({ row }) => <Percent value={row.original.compliance} />,
    },
    { id: "score", header: t("fields.score"), cell: ({ row }) => <Percent value={row.original.score} /> },
    {
      id: "toCheck",
      header: t("fields.toCheck"),
      cell: ({ row }) => (row.original.toCheck === null ? null : row.original.toCheck),
    },
    {
      id: "unaudited",
      header: t("fields.unaudited"),
      cell: ({ row }) => ("unaudited" in row.original ? row.original.unaudited : null),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      label={t("consultants")}
      empty={empty}
      getRowId={(row) => ("team" in row ? "team" : (row.consultant?.id ?? "none"))}
    />
  );
}

/** "Leads to check": the name opens the lead, which has the audit card (A-085). */
export function LeadsToCheckTable({
  rows,
  empty,
  footer,
}: {
  rows: LeadToCheck[];
  empty: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("leadAudit");

  const columns: DataTableColumn<LeadToCheck>[] = [
    {
      id: "lead",
      header: t("fields.lead"),
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <Link href={`/leads/${row.original.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.original.fullName}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{row.original.leadCode}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="lead" status={row.original.status} />,
    },
    { id: "pic", header: t("consultant"), cell: ({ row }) => row.original.pic?.name ?? t("noConsultant") },
    {
      id: "late",
      header: t("fields.late"),
      cell: ({ row }) => (row.original.late > 0 ? <Badge variant="destructive">{row.original.late}</Badge> : 0),
    },
    {
      id: "skipped",
      header: t("fields.skipped"),
      cell: ({ row }) => (row.original.skipped > 0 ? <Badge variant="warning">{row.original.skipped}</Badge> : 0),
    },
    {
      id: "failed",
      header: t("fields.failed"),
      cell: ({ row }) =>
        row.original.failed.length === 0 ? (
          <span className="text-muted-foreground">{t("noData")}</span>
        ) : (
          row.original.failed.map((key) => t(`criteria.${key}`)).join(", ")
        ),
    },
    { id: "score", header: t("fields.score"), cell: ({ row }) => <Percent value={row.original.score} /> },
    {
      id: "createdAt",
      header: t("fields.createdAt"),
      cell: ({ row }) => <DateTime value={row.original.createdAt} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      label={t("toCheck")}
      empty={empty}
      footer={footer}
      getRowId={(row) => row.id}
    />
  );
}

/** "Chưa audit": people no manager has audited, oldest first; the name opens the lead to grade it (A-088). */
export function UnauditedTable({
  rows,
  empty,
  footer,
}: {
  rows: UnauditedLead[];
  empty: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("leadAudit");

  const columns: DataTableColumn<UnauditedLead>[] = [
    {
      id: "lead",
      header: t("fields.lead"),
      cell: ({ row }) => (
        <span className="flex flex-col gap-0.5">
          <Link href={`/leads/${row.original.id}`} className="font-medium underline-offset-4 hover:underline">
            {row.original.fullName}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{row.original.leadCode}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="lead" status={row.original.status} />,
    },
    { id: "pic", header: t("consultant"), cell: ({ row }) => row.original.pic?.name ?? t("noConsultant") },
    {
      id: "createdAt",
      header: t("fields.createdAt"),
      cell: ({ row }) => <DateTime value={row.original.createdAt} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      label={t("queue.title")}
      empty={empty}
      footer={footer}
      getRowId={(row) => row.id}
    />
  );
}
