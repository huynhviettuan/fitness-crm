"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";

export type ContractRow = {
  id: string;
  contractCode: string;
  customer: { id: string; customerCode: string; fullName: string };
  packageName: string;
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "REJECTED";
  totalSessions: number;
  remainingSessions: number;
  contractValue: number;
  debt: number;
};

type ContractsTableProps = {
  contracts: ContractRow[];
  /** Hide the customer column on a customer's own page. */
  showCustomer?: boolean;
  empty: ReactNode;
  footer?: ReactNode;
};

export function ContractsTable({ contracts, showCustomer = true, empty, footer }: ContractsTableProps) {
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
    { id: "packageName", header: t("fields.packageName"), cell: ({ row }) => row.original.packageName },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="contract" status={row.original.status} />,
    },
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
