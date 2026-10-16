"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { HandCoinsIcon } from "lucide-react";
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
import { applyFieldErrors } from "@/components/form-fields";
import { Money } from "@/components/money";
import { OptionSelect } from "@/components/option-select";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { ptPayoutInputSchema } from "@gymcrm/shared/payouts";
import { createPayoutAction } from "./actions";

const choiceSchema = ptPayoutInputSchema.pick({
  categoryId: true,
  categoryNote: true,
  methodId: true,
  methodNote: true,
});

type Values = { categoryId: string; categoryNote: string; methodId: string; methodNote: string };

/** Pays a PT the sessions of the period not paid yet, and takes back the paid ones deleted since (M5.7, FR-CASH-003). */
export function PayoutButton({
  trainer,
  period,
  payable,
}: {
  trainer: { id: string; fullName: string };
  /** dd/MM/yyyy, the report's period. */
  period: { from: string; to: string };
  payable: number;
}) {
  const t = useTranslations("ptRevenue.payout");
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={payable <= 0}
        onClick={() => {
          setIdempotencyKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        <HandCoinsIcon />
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("title", { name: trainer.fullName })}</DialogTitle>
            <DialogDescription>{t("description", { from: period.from, to: period.to })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {t("amount")}: <span className="font-semibold">{<Money amount={payable} />}</span>
          </p>
          {/* Mounted only while open, so every opening starts from fresh values. */}
          <PayoutForm
            trainerId={trainer.id}
            period={period}
            idempotencyKey={idempotencyKey}
            onClose={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function PayoutForm({
  trainerId,
  period,
  idempotencyKey,
  onClose,
}: {
  trainerId: string;
  period: { from: string; to: string };
  idempotencyKey: string;
  onClose: () => void;
}) {
  const t = useTranslations("ptRevenue.payout");
  const common = useTranslations("common");
  const approvals = useTranslations("approvals");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(choiceSchema, undefined, { raw: true }) as never,
    defaultValues: { categoryId: "", categoryNote: "", methodId: "", methodNote: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await createPayoutAction({ trainerId, ...period, ...values }, idempotencyKey);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(result.data.pending ? approvals("submitted") : t("paid", { number: result.data.number }));
      onClose();
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        <OptionSelect
          control={form.control}
          name="categoryId"
          noteName="categoryNote"
          listKey="expenseTypes"
          label={t("category")}
        />
        <OptionSelect
          control={form.control}
          name="methodId"
          noteName="methodNote"
          listKey="paymentMethods"
          label={t("method")}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {common("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? common("saving") : t("confirm")}
        </Button>
      </DialogFooter>
    </form>
  );
}
