"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";

export type ContractRow = {
  id: string;
  contractCode: string;
  customer: { id: string; customerCode: string; fullName: string };
  customerPhone: string | null;
  branch: { id: string; name: string };
  contractType: "NEW" | "RENEW";
  contractDate: Date;
  service: { id: string; name: string } | null;
  packageName: string;
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "REJECTED";
  approvedUnitPrice: number;
  startDate: Date;
  endDate: Date;
  totalSessions: number;
  openingSessionsUsed: number;
  completedSessions: number;
  remainingSessions: number;
  contractValue: number;
  paidAmount: number;
  debt: number;
};

type ContractsTableProps = {
  contracts: ContractRow[];
  /** Hide the customer column on a customer's own page. */
  showCustomer?: boolean;
  /** Every column of the contract list (brief §5.3); the other lists keep the short form. */
  full?: boolean;
  empty: ReactNode;
  footer?: ReactNode;
};

export function ContractsTable({ contracts, showCustomer = true, full = false, empty, footer }: ContractsTableProps) {
  const t = useTranslations("contracts");

  const columns: DataTableColumn<ContractRow>[] = [
    {
      id: "contractCode",
      header: t("fields.contractCode"),
      cell: ({ row }) => (
        <Link href={`/contracts/${row.original.id}`} className="font-mono text-sm font-medium hover:underline">
          {row.original.contractCode}
        </Link>
      ),
    },
    ...(showCustomer
      ? [
          {
            id: "customer",
            header: t("fields.customer"),
            cell: ({ row }) => (
              <Link href={`/customers/${row.original.customer.id}`} className="hover:underline">
                {row.original.customer.fullName}
              </Link>
            ),
          } satisfies DataTableColumn<ContractRow>,
        ]
      : []),
    ...(full ? fullColumns(t) : shortColumns(t)),
  ];

  return (
    <DataTable
      columns={columns}
      data={contracts}
      label={t("title")}
      empty={empty}
      footer={footer}
      getRowId={(row) => row.id}
    />
  );
}

type Translate = ReturnType<typeof useTranslations<"contracts">>;

function shortColumns(t: Translate): DataTableColumn<ContractRow>[] {
  return [
    { id: "packageName", header: t("fields.packageName"), cell: ({ row }) => row.original.packageName },
    statusColumn(t),
    {
      id: "sessions",
      header: t("fields.remainingSessions"),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {t("sessionsOf", { remaining: row.original.remainingSessions, total: row.original.totalSessions })}
        </span>
      ),
    },
    {
      id: "contractValue",
      header: t("fields.contractValue"),
      cell: ({ row }) => <Money amount={row.original.contractValue} />,
    },
    { id: "debt", header: t("fields.debt"), cell: ({ row }) => <Money amount={row.original.debt} /> },
  ];
}

/** Brief §5.3: the contract date, branch, type, service, status, prices, dates, and sessions of each contract. */
function fullColumns(t: Translate): DataTableColumn<ContractRow>[] {
  const number = (id: string, header: string, value: (row: ContractRow) => number): DataTableColumn<ContractRow> => ({
    id,
    header,
    cell: ({ row }) => <span className="tabular-nums">{value(row.original)}</span>,
  });
  const day = (id: string, header: string, value: (row: ContractRow) => Date): DataTableColumn<ContractRow> => ({
    id,
    header,
    cell: ({ row }) => <DateTime value={value(row.original)} format="dateOnly" />,
  });
  return [
    {
      id: "phone",
      header: t("fields.phone"),
      cell: ({ row }) => row.original.customerPhone ?? <HiddenValue />,
    },
    day("contractDate", t("fields.contractDate"), (row) => row.contractDate),
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    {
      id: "contractType",
      header: t("fields.contractType"),
      cell: ({ row }) => t(`types.${row.original.contractType}`),
    },
    {
      id: "service",
      header: t("fields.service"),
      cell: ({ row }) => row.original.service?.name ?? t("fields.imported"),
    },
    statusColumn(t),
    {
      id: "unitPrice",
      header: t("fields.approvedUnitPrice"),
      cell: ({ row }) => <Money amount={row.original.approvedUnitPrice} />,
    },
    {
      id: "contractValue",
      header: t("fields.contractValue"),
      cell: ({ row }) => <Money amount={row.original.contractValue} />,
    },
    { id: "paid", header: t("fields.paidAmount"), cell: ({ row }) => <Money amount={row.original.paidAmount} /> },
    { id: "debt", header: t("fields.debt"), cell: ({ row }) => <Money amount={row.original.debt} /> },
    day("startDate", t("fields.startDate"), (row) => row.startDate),
    day("endDate", t("fields.endDate"), (row) => row.endDate),
    number("totalSessions", t("fields.totalSessions"), (row) => row.totalSessions),
    number("usedSessions", t("fields.usedSessions"), (row) => row.openingSessionsUsed + row.completedSessions),
    number("remainingSessions", t("fields.remainingSessions"), (row) => row.remainingSessions),
  ];
}

function statusColumn(t: Translate): DataTableColumn<ContractRow> {
  return {
    id: "status",
    header: t("fields.status"),
    cell: ({ row }) => <StatusBadge entity="contract" status={row.original.status} />,
  };
}
