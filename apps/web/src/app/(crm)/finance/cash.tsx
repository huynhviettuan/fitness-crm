"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReceiptTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { DateTime } from "@/components/date-time";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { ChosenOptionText, OptionSelect, useChosenOptionText } from "@/components/option-select";
import { Money } from "@/components/money";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import { formatDate, formatMoney } from "@/lib/format";
import { CASH_TRANSACTION_TYPES, cashTransactionInputSchema, type CashTransactionInput } from "@flow/shared/finance";
import type { ChosenOption } from "@flow/shared/options";
import { recordCashTransactionAction, voidCashTransactionAction } from "./actions";
import { VoidDialog } from "./void-dialog";

export type CashRow = {
  id: string;
  type: (typeof CASH_TRANSACTION_TYPES)[number];
  category: ChosenOption;
  amount: number;
  description: string | null;
  reference: string | null;
  occurredOn: Date;
  status: "CONFIRMED" | "VOIDED";
  createdBy: string;
  voidedBy: string | null;
  voidReason: ChosenOption | null;
};

/** Income and expense entries (FR-CASH-001). Corrected by voiding and recording again (A-009). */
export function CashTable({ transactions, label, empty, footer }: { transactions: CashRow[]; label: string; empty: ReactNode; footer?: ReactNode }) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const router = useRouter();
  const [voiding, setVoiding] = useState<CashRow | null>(null);
  const chosenText = useChosenOptionText();

  const columns: DataTableColumn<CashRow>[] = [
    { id: "occurredOn", header: t("fields.occurredOn"), cell: ({ row }) => <DateTime value={row.original.occurredOn} format="dateOnly" /> },
    { id: "type", header: t("fields.type"), cell: ({ row }) => t(`types.${row.original.type}`) },
    {
      id: "category",
      header: t("fields.category"),
      cell: ({ row }) => (
        <div className="max-w-64 whitespace-normal">
          <p>
            <ChosenOptionText option={row.original.category} />
          </p>
          {row.original.description && <p className="text-xs text-muted-foreground">{row.original.description}</p>}
        </div>
      ),
    },
    { id: "reference", header: t("fields.reference"), cell: ({ row }) => row.original.reference },
    {
      id: "amount",
      header: t("fields.amount"),
      cell: ({ row }) => <Money amount={row.original.amount} struck={row.original.status === "VOIDED"} />,
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: ({ row }) => (
        <div className="space-y-1">
          <StatusBadge entity="cashTransaction" status={row.original.status} />
          {row.original.voidReason && (
            <p className="max-w-56 text-xs whitespace-normal text-muted-foreground">
              {t("voidedBy", { name: row.original.voidedBy ?? "", reason: chosenText(row.original.voidReason) })}
            </p>
          )}
        </div>
      ),
    },
    { id: "createdBy", header: t("fields.createdBy"), cell: ({ row }) => row.original.createdBy },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("void")}</span>,
      cell: ({ row }) =>
        row.original.status === "CONFIRMED" && (
          <Button variant="ghost" size="sm" onClick={() => setVoiding(row.original)}>
            {t("void")}
          </Button>
        ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={transactions} label={label} empty={empty} footer={footer} getRowId={(row) => row.id} />
      <VoidDialog
        open={voiding !== null}
        onOpenChange={(open) => !open && setVoiding(null)}
        title={t("voidCashTitle", { amount: voiding ? formatMoney(voiding.amount, locale) : "" })}
        description={t("voidCashBody")}
        onVoid={(input) => voidCashTransactionAction(voiding!.id, input)}
        onVoided={() => {
          setVoiding(null);
          router.refresh();
        }}
      />
    </>
  );
}

type CashFormValues = {
  branchId: string;
  type: string;
  categoryId: string;
  categoryNote: string;
  amount: string;
  occurredOn: string;
  reference: string;
  description: string;
};

type BranchOption = { id: string; name: string };

/** "Record income or expense": six fields, so a Dialog (docs/23 §7). */
export function RecordCashButton({ branches }: { branches: BranchOption[] }) {
  const t = useTranslations("finance");
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
        <ReceiptTextIcon />
        {t("recordCash")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("recordCash")}</DialogTitle>
          <DialogDescription>{t("recordCashDescription")}</DialogDescription>
        </DialogHeader>
        <CashForm idempotencyKey={idempotencyKey} branches={branches} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CashForm({ idempotencyKey, branches, onDone }: { idempotencyKey: string; branches: BranchOption[]; onDone: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const timeZone = useTimeZone() ?? "UTC";
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  // Same schema as the server for instant feedback; raw values are sent and re-parsed there.
  const form = useForm<CashFormValues>({
    resolver: zodResolver(cashTransactionInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      branchId: "",
      type: "",
      categoryId: "",
      categoryNote: "",
      amount: "",
      occurredOn: formatDate(new Date(), timeZone),
      reference: "",
      description: "",
    },
  });

  // Income and expenses have their own lists (D-034); the category follows the type.
  const type = useWatch({ control: form.control, name: "type" });
  const listKey = type === "INCOME" ? "incomeCategories" : type === "EXPENSE" ? "expenseTypes" : null;
  const { setValue } = form;
  useEffect(() => setValue("categoryId", ""), [listKey, setValue]);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await recordCashTransactionAction(values as CashTransactionInput, idempotencyKey);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("finance.cashRecorded"));
      onDone();
      router.refresh();
    }),
  );

  const f = "finance.fields" as const;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        {/* Asked only when the user works in more than one branch (D-014). */}
        {branches.length > 1 && (
          <SelectField
            control={form.control}
            name="branchId"
            label={t("finance.fields.branch")}
            placeholder={t("common.chooseBranch")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            control={form.control}
            name="type"
            label={t(`${f}.type`)}
            placeholder={t("bookings.choose")}
            options={CASH_TRANSACTION_TYPES.map((value) => ({ value, label: t(`finance.types.${value}`) }))}
          />
          <TextField
            control={form.control}
            name="occurredOn"
            label={t(`${f}.occurredOn`)}
            placeholder={t("finance.datePlaceholder")}
            inputMode="numeric"
          />
        </div>
        <OptionSelect control={form.control} name="categoryId" noteName="categoryNote" listKey={listKey} label={t(`${f}.category`)} />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            control={form.control}
            name="amount"
            label={t(`${f}.amount`)}
            placeholder={t("finance.amountPlaceholder")}
            inputMode="numeric"
          />
          <TextField control={form.control} name="reference" label={t(`${f}.reference`)} autoComplete="off" />
        </div>
        <TextField control={form.control} name="description" label={t(`${f}.description`)} multiline />
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
