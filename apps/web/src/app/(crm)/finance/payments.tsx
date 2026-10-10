"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BanknoteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { ChosenOptionText, OptionSelect } from "@/components/option-select";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { formatDate, formatMoney } from "@/lib/format";
import { paymentInputSchema, type PaymentInput } from "@flow/shared/finance";
import type { ChosenOption } from "@flow/shared/options";
import { deletePaymentAction, recordPaymentAction } from "./actions";
import { DeleteDialog } from "./delete-dialog";

export type PaymentRow = {
  id: string;
  amount: number;
  method: ChosenOption;
  paidOn: Date;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  createdBy: string;
  contract: { id: string; contractCode: string; packageName: string };
  customer: { id: string; customerCode: string; fullName: string };
};

type PaymentsTableProps = {
  payments: PaymentRow[];
  /** payment.delete (09_RBAC.md). */
  canDelete: boolean;
  label: string;
  /** Hide columns the page already shows. */
  hide?: { contract?: boolean; customer?: boolean };
  empty: ReactNode;
  footer?: ReactNode;
};

/** Payment history (FR-PAY-002). A deleted payment leaves the list for the trash (D-035). */
export function PaymentsTable({ payments, canDelete, label, hide = {}, empty, footer }: PaymentsTableProps) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const router = useRouter();
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);

  const columns: DataTableColumn<PaymentRow>[] = [
    { id: "paidOn", header: t("fields.paidOn"), cell: ({ row }) => <DateTime value={row.original.paidOn} format="dateOnly" /> },
    {
      id: "amount",
      header: t("fields.amount"),
      cell: ({ row }) => <Money amount={row.original.amount} />,
    },
    { id: "method", header: t("fields.method"), cell: ({ row }) => <ChosenOptionText option={row.original.method} /> },
    ...(hide.customer
      ? []
      : [
          {
            id: "customer",
            header: t("fields.customer"),
            cell: ({ row }) => (
              <Link href={`/customers/${row.original.customer.id}`} className="hover:underline">
                {row.original.customer.fullName}
              </Link>
            ),
          } satisfies DataTableColumn<PaymentRow>,
        ]),
    ...(hide.contract
      ? []
      : [
          {
            id: "contract",
            header: t("fields.contract"),
            cell: ({ row }) => (
              <Link href={`/contracts/${row.original.contract.id}`} className="font-mono text-sm hover:underline">
                {row.original.contract.contractCode}
              </Link>
            ),
          } satisfies DataTableColumn<PaymentRow>,
        ]),
    {
      id: "approvalStatus",
      header: t("fields.approvalStatus"),
      cell: ({ row }) => <StatusBadge entity="approval" status={row.original.approvalStatus} />,
    },
    { id: "createdBy", header: t("fields.createdBy"), cell: ({ row }) => row.original.createdBy },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("delete")}</span>,
      cell: ({ row }) =>
        canDelete && (
          <Button variant="ghost" size="sm" onClick={() => setDeleting(row.original)}>
            {t("delete")}
          </Button>
        ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={payments} label={label} empty={empty} footer={footer} getRowId={(row) => row.id} />
      <DeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("deletePaymentTitle", { amount: deleting ? formatMoney(deleting.amount, locale) : "" })}
        description={t("deletePaymentBody")}
        onDelete={(input) => deletePaymentAction(deleting!.id, input)}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </>
  );
}

type PaymentFormValues = { amount: string; methodId: string; methodNote: string; paidOn: string };

/** "Record payment" for one contract (FR-PAY-001): three fields, so a Dialog. */
export function RecordPaymentButton({ contract }: { contract: { id: string; debt: number } }) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  // New key each time the dialog opens; retries and double-clicks inside it reuse it (T-015).
  const [idempotencyKey, setIdempotencyKey] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setIdempotencyKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        <BanknoteIcon />
        {t("recordPayment")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("recordPayment")}</DialogTitle>
          <DialogDescription>{t("recordPaymentDescription", { debt: formatMoney(contract.debt, locale) })}</DialogDescription>
        </DialogHeader>
        <PaymentForm contractId={contract.id} idempotencyKey={idempotencyKey} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({ contractId, idempotencyKey, onDone }: { contractId: string; idempotencyKey: string; onDone: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const timeZone = useTimeZone() ?? "UTC";
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  // Same schema as the server for instant feedback; raw values are sent and re-parsed there.
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentInputSchema, undefined, { raw: true }) as never,
    defaultValues: { amount: "", methodId: "", methodNote: "", paidOn: formatDate(new Date(), timeZone) },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await recordPaymentAction(contractId, values as PaymentInput, idempotencyKey);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      // A payment under the approval matrix counts once approved (D-018).
      notify.success(result.data.pending ? t("approvals.submitted") : t("finance.paymentRecorded"));
      onDone();
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        <TextField
          control={form.control}
          name="amount"
          label={t("finance.fields.amount")}
          placeholder={t("finance.amountPlaceholder")}
          inputMode="numeric"
        />
        <OptionSelect
          control={form.control}
          name="methodId"
          noteName="methodNote"
          listKey="paymentMethods"
          label={t("finance.fields.method")}
        />
        <TextField
          control={form.control}
          name="paidOn"
          label={t("finance.fields.paidOn")}
          placeholder={t("finance.datePlaceholder")}
          inputMode="numeric"
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
