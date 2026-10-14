"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PauseCircleIcon, RefreshCwIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { holdInputSchema, renewalInputSchema, type HoldInput, type RenewalInput } from "@flow/shared/changes";
import { useSubmit } from "../admin/users/user-dialogs";
import { raiseHoldAction, raiseRenewalAction } from "./change-actions";

type ContractRef = { id: string; contractCode: string };

/** The dialog both buttons open: the fields, and the save that tells whether the voucher waits for approval. */
function VoucherDialog<T extends Record<string, string>>({
  title,
  description,
  form,
  run,
  onClose,
  children,
}: {
  title: string;
  description: string;
  form: ReturnType<typeof useForm<T>>;
  /** Raises the voucher; the key is made when the dialog opens and kept for retries (T-015). */
  run: (values: T, key: string) => ReturnType<typeof raiseRenewalAction>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("contractChanges");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run: submit } = useSubmit();
  const [key] = useState(() => crypto.randomUUID());
  const onSubmit = form.handleSubmit((values) =>
    submit(
      () => run(values, key),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      (data) => {
        notify.success(data.pending ? t("raisedPending") : t("raisedDone"));
        onClose();
        router.refresh();
      },
    ),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? common("saving") : t("raise")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type RenewalValues = { fromDate: string; months: string; days: string; sessions: string; amount: string; note: string };

/** A renewal: months, days or sessions added to the contract, and the amount to pay for them (brief §5.6). */
export function RenewalButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RefreshCwIcon />
        {t("renewal")}
      </Button>
      {open && <RenewalDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function RenewalDialog({ contract, onClose }: { contract: ContractRef; onClose: () => void }) {
  const t = useTranslations("contractChanges");
  const form = useForm<RenewalValues>({
    resolver: ((values: RenewalValues, context: unknown, options: never) =>
      zodResolver(renewalInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { fromDate: "", months: "", days: "", sessions: "", amount: "", note: "" },
  });
  return (
    <VoucherDialog
      title={t("renewalTitle", { code: contract.contractCode })}
      description={t("renewalDescription")}
      form={form}
      run={(values, key) => raiseRenewalAction({ contractId: contract.id, ...values } as RenewalInput, key)}
      onClose={onClose}
    >
      <TextField control={form.control} name="fromDate" label={t("fields.fromDate")} placeholder={t("fromHint")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={form.control} name="months" label={t("fields.months")} inputMode="numeric" />
        <TextField control={form.control} name="days" label={t("fields.days")} inputMode="numeric" />
        <TextField control={form.control} name="sessions" label={t("fields.sessions")} inputMode="numeric" />
      </div>
      <TextField control={form.control} name="amount" label={t("fields.amount")} inputMode="numeric" />
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}

type HoldValues = { fromDate: string; toDate: string; note: string };

/** A hold: the contract stops for the days asked, which are added to its end (brief §5.6). */
export function HoldButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contractChanges");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PauseCircleIcon />
        {t("hold")}
      </Button>
      {open && <HoldDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function HoldDialog({ contract, onClose }: { contract: ContractRef; onClose: () => void }) {
  const t = useTranslations("contractChanges");
  const form = useForm<HoldValues>({
    resolver: ((values: HoldValues, context: unknown, options: never) =>
      zodResolver(holdInputSchema as never, undefined, { raw: true })(
        { contractId: contract.id, ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { fromDate: "", toDate: "", note: "" },
  });
  return (
    <VoucherDialog
      title={t("holdTitle", { code: contract.contractCode })}
      description={t("holdDescription")}
      form={form}
      run={(values, key) => raiseHoldAction({ contractId: contract.id, ...values } as HoldInput, key)}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={form.control} name="fromDate" label={t("fields.fromDate")} placeholder={t("dayHint")} />
        <TextField control={form.control} name="toDate" label={t("fields.toDate")} placeholder={t("dayHint")} />
      </div>
      <TextField control={form.control} name="note" label={t("fields.note")} multiline />
    </VoucherDialog>
  );
}
