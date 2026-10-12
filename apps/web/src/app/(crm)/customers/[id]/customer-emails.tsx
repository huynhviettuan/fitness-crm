"use client";

import { useTranslations } from "next-intl";
import { MailIcon } from "lucide-react";
import type { EmailMessage } from "@flow/shared/mail";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { HiddenValue } from "@/components/hidden-value";
import { StatusBadge } from "@/components/status-badge";

/** The "Emails sent" tab (FR-MAIL-003): every email to the customer with its status; a failure says why. */
export function CustomerEmails({ emails }: { emails: EmailMessage[] }) {
  const t = useTranslations("mail");

  const columns: DataTableColumn<EmailMessage>[] = [
    {
      id: "createdAt",
      header: t("columns.createdAt"),
      cell: ({ row }) => <DateTime value={row.original.createdAt} format="dateTime" />,
    },
    {
      id: "event",
      header: t("columns.event"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.event}</span>,
    },
    { id: "subject", header: t("columns.subject"), cell: ({ row }) => row.original.subject },
    {
      id: "to",
      header: t("columns.to"),
      cell: ({ row }) => row.original.toAddress ?? (row.original.failure === "noEmail" ? "—" : <HiddenValue />),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: ({ row }) => (
        <div className="space-y-1">
          <StatusBadge entity="email" status={row.original.status} />
          {row.original.failure && (
            <p className="text-xs text-muted-foreground">{t(`failure.${row.original.failure}`)}</p>
          )}
        </div>
      ),
    },
    { id: "attempts", header: t("columns.attempts"), cell: ({ row }) => row.original.attempts },
  ];

  return (
    <DataTable
      columns={columns}
      data={emails}
      label={t("title")}
      empty={<EmptyState icon={MailIcon} title={t("empty")} />}
      getRowId={(row) => row.id}
    />
  );
}
