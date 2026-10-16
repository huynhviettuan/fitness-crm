"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { HiddenValue } from "@/components/hidden-value";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";

export type CustomerRow = {
  id: string;
  customerCode: string;
  fullName: string;
  /** Null when the phone is hidden from the user (D-017). */
  phone: string | null;
  /** Null when there is none, or when the email is hidden from the user (see maskedFields). */
  email: string | null;
  maskedFields: ("phone" | "email" | "address" | "idDocument" | "health")[];
  staffInCharge: { id: string; name: string } | null;
  branch: { id: string; name: string };
  status: "ACTIVE" | "INACTIVE";
  contractStatus: "NO_CONTRACT" | "TRAINING" | "EXPIRING_SOON" | "EXPIRED" | "ON_HOLD";
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
    {
      id: "email",
      header: t("fields.email"),
      cell: ({ row }) => {
        const { email, maskedFields } = row.original;
        if (maskedFields.includes("email")) return <HiddenValue />;
        // FR-CUS-005: reception sees at a glance who still needs an email.
        return (
          email ?? (
            <Badge variant="warning" title={t("noEmailHint")}>
              {t("noEmail")}
            </Badge>
          )
        );
      },
    },
    {
      id: "staffInCharge",
      header: t("fields.staffInCharge"),
      cell: ({ row }) => row.original.staffInCharge?.name ?? <span className="text-muted-foreground">—</span>,
    },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => <StatusBadge entity="customer" status={row.original.status} />,
    },
    {
      id: "contractStatus",
      header: t("fields.contractStatus"),
      cell: ({ row }) => <StatusBadge entity="customerContract" status={row.original.contractStatus} />,
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
