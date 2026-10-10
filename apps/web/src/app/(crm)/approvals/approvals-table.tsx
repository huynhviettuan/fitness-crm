"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { applyFieldErrors } from "@/components/form-fields";
import { HiddenValue } from "@/components/hidden-value";
import { Money } from "@/components/money";
import { notify } from "@/components/notify";
import { ChosenOptionText, OptionSelect, useChosenOptionText } from "@/components/option-select";
import { StatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import { rejectSchema, type APPROVAL_VIEWS, type ApprovalRequest } from "@flow/shared/approvals";
import type { ChosenOption } from "@flow/shared/options";
import { useSubmit } from "../admin/users/user-dialogs";
import { messageKey } from "./message-key";
import { approveAction, rejectAction } from "./actions";

type Props = { requests: ApprovalRequest[]; view: (typeof APPROVAL_VIEWS)[number]; empty: ReactNode; footer?: ReactNode };

/** Requests with what approving would do; approve and reject where the user may (D-018). */
export function ApprovalsTable({ requests, view, empty, footer }: Props) {
  const t = useTranslations("approvals");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [approving, setApproving] = useState<ApprovalRequest | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalRequest | null>(null);

  const columns: DataTableColumn<ApprovalRequest>[] = [
    { id: "submittedAt", header: t("fields.submittedAt"), cell: ({ row }) => <DateTime value={row.original.submittedAt} format="dateTime" /> },
    { id: "action", header: t("fields.action"), cell: ({ row }) => t(`actions.${messageKey(row.original.action)}`) },
    {
      id: "record",
      header: t("fields.record"),
      cell: ({ row }) => (
        <div className="max-w-72 space-y-1 whitespace-normal">
          <p className="font-medium">{row.original.title}</p>
          <Changes request={row.original} />
        </div>
      ),
    },
    {
      id: "amount",
      header: t("fields.amount"),
      cell: ({ row }) =>
        row.original.amount === null ? (row.original.action === "customer.identity" ? null : <HiddenValue />) : <Money amount={row.original.amount} />,
    },
    { id: "branch", header: t("fields.branch"), cell: ({ row }) => row.original.branch.name },
    { id: "submittedBy", header: t("fields.submittedBy"), cell: ({ row }) => row.original.submittedBy.name },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge entity="approval" status={row.original.status} />
          {row.original.overdue && <Badge variant="destructive">{t("overdue")}</Badge>}
          {row.original.decidedBy && <span className="text-xs text-muted-foreground">{row.original.decidedBy.name}</span>}
          {row.original.rejectReason && (
            <span className="block w-full text-xs text-muted-foreground">
              <ChosenOptionText option={row.original.rejectReason} />
            </span>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("fields.actions")}</span>,
      cell: ({ row }) =>
        row.original.canDecide && (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setApproving(row.original)} aria-label={t("approveLabel", { name: row.original.title })}>
              <CheckIcon />
              {t("approve")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(row.original)} aria-label={t("rejectLabel", { name: row.original.title })}>
              <XIcon />
              {t("reject")}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={requests} label={t(`views.${view}`)} empty={empty} footer={footer} getRowId={(row) => row.id} />
      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(open) => !open && setApproving(null)}
        title={t("approveTitle", { name: approving?.title ?? "" })}
        description={approving ? t(`approveBody.${messageKey(approving.action)}`) : ""}
        confirmLabel={t("approve")}
        onConfirm={async () => {
          const result = await approveAction(approving!.id);
          if (!result.ok) {
            notify.error(errorMessage(result.code));
            return false;
          }
          notify.success(t("approved"));
          setApproving(null);
          router.refresh();
        }}
      />
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />}
    </>
  );
}

/** What approving would change: a customer's new values, or a deletion's reason. */
function Changes({ request }: { request: ApprovalRequest }) {
  const t = useTranslations();
  const text = useChosenOptionText();
  const changes = request.changes;
  if (request.action === "record.delete" && changes.reason) {
    return <p className="text-xs text-muted-foreground">{t("approvals.deleteReason", { reason: text(changes.reason as ChosenOption) })}</p>;
  }
  if (request.action === "customer.identity") {
    const fields = (["fullName", "phone", "email"] as const).filter((field) => field in changes);
    return (
      <p className="text-xs text-muted-foreground">
        {fields.map((field) => `${t(`customers.fields.${field}`)}: ${(changes[field] as string | null) ?? "—"}`).join("; ")}
      </p>
    );
  }
  return null;
}

function RejectDialog({ request, onClose }: { request: ApprovalRequest; onClose: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<{ reasonId: string; reasonNote: string }>({
    resolver: zodResolver(rejectSchema, undefined, { raw: true }) as never,
    defaultValues: { reasonId: "", reasonNote: "" },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => rejectAction(request.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("approvals.rejected"));
        onClose();
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("approvals.rejectTitle", { name: request.title })}</DialogTitle>
            <DialogDescription>{t("approvals.rejectBody")}</DialogDescription>
          </DialogHeader>
          <OptionSelect control={form.control} name="reasonId" noteName="reasonNote" listKey="rejectReasons" label={t("approvals.rejectReason")} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {t("approvals.reject")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
