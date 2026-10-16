"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MailIcon } from "lucide-react";
import type { EmailMessage, EmailMessageDetail } from "@gymcrm/shared/mail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { HiddenValue } from "@/components/hidden-value";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import { getCustomerEmailAction } from "../actions";

/**
 * The "Emails sent" tab (FR-MAIL-003): every email to the customer with its status; a failure says why. "View" opens what
 * the email said (A-317); an email the server only recorded (trial mode) is marked so.
 */
export function CustomerEmails({ customerId, emails }: { customerId: string; emails: EmailMessage[] }) {
  const t = useTranslations("mail");
  const errorMessage = useErrorMessage();
  const [opening, setOpening] = useState<string | null>(null);
  const [open, setOpen] = useState<EmailMessageDetail | null>(null);

  const view = async (email: EmailMessage) => {
    setOpening(email.id);
    const result = await getCustomerEmailAction(customerId, email.id);
    setOpening(null);
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return;
    }
    setOpen(result.data);
  };

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
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge entity="email" status={row.original.status} />
            {row.original.recordedOnly && (
              <Badge variant="outline" title={t("recordedOnlyHint")}>
                {t("recordedOnly")}
              </Badge>
            )}
          </div>
          {row.original.failure && (
            <p className="text-xs text-muted-foreground">{t(`failure.${row.original.failure}`)}</p>
          )}
        </div>
      ),
    },
    { id: "attempts", header: t("columns.attempts"), cell: ({ row }) => row.original.attempts },
    {
      id: "actions",
      header: t("columns.actions"),
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          disabled={opening === row.original.id}
          aria-label={t("viewLabel", { subject: row.original.subject })}
          onClick={() => void view(row.original)}
        >
          {opening === row.original.id ? t("detail.loading") : t("view")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={emails}
        label={t("title")}
        empty={<EmptyState icon={MailIcon} title={t("empty")} />}
        getRowId={(row) => row.id}
      />
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.subject}</DialogTitle>
                <DialogDescription>
                  {t("columns.to")}: {open.toAddress ?? "—"} · {t("detail.sentAt")}:{" "}
                  {open.sentAt ? <DateTime value={open.sentAt} format="dateTime" /> : t("detail.notSent")}
                </DialogDescription>
              </DialogHeader>
              {open.recordedOnly && (
                <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {t("recordedOnlyHint")}
                </p>
              )}
              <pre
                aria-label={t("detail.title")}
                className="max-h-[60vh] overflow-auto rounded-md border p-3 font-sans text-sm whitespace-pre-wrap"
              >
                {open.body}
              </pre>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
