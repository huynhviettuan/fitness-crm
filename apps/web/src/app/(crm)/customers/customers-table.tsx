"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { HiddenValue } from "@/components/hidden-value";
import { StatusBadge } from "@/components/status-badge";

export type CustomerRow = {
  id: string;
  customerCode: string;
  fullName: string;
  /** Null when the phone is hidden from the user (D-017). */
  phone: string | null;
  branch: { id: string; name: string };
  status: "ACTIVE" | "INACTIVE";
  createdAt: Date;
};

type CustomersTableProps = {
  customers: CustomerRow[];
  empty: ReactNode;
  footer: ReactNode;
};

export function CustomersTable({ customers, empty, footer }: CustomersTableProps) {
  const t = useTranslations("customers");

  const columns: DataTableColumn<CustomerRow>[] = [
    {
      id: "customerCode",
      header: t("fields.customerCode"),
      cell: ({ row }) => (
        <Link href={`/customers/${row.original.id}`} className="font-mono text-sm font-medium hover:underline">
          {row.original.customerCode}
        </Link>
      ),
    },
    {
      id: "fullName",
      header: t("fields.fullName"),
      cell: ({ row }) => (
        <Link href={`/customers/${row.original.id}`} className="hover:underline">
          {row.original.fullName}
        </Link>
      ),
    },
    { id: "phone", header: t("fields.phone"), cell: ({ row }) => row.original.phone ?? <HiddenValue /> },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="customer" status={row.original.status} />,
    },
    {
      id: "createdAt",
      header: t("fields.createdAt"),
      cell: ({ row }) => <DateTime value={row.original.createdAt} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={customers}
      label={t("title")}
      empty={empty}
      footer={footer}
      getRowId={(row) => row.id}
    />
  );
}
