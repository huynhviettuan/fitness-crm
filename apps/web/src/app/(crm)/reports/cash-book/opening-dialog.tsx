"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LandmarkIcon } from "lucide-react";
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
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { formatDate } from "@/lib/format";
import { cashOpeningInputSchema, type CashOpeningInput } from "@flow/shared/finance";
import { useSubmit } from "../../admin/users/user-dialogs";
import { setCashOpeningAction } from "./actions";

type Choice = { value: string; label: string };
type FormValues = { branchId: string; methodId: string; effectiveOn: string; amount: string };

/**
 * "Opening balance" (A-138): the cash a branch held in a payment method when its books begin. It moves every closing
 * balance after it, so only Admin sees the button; the API audits each change.
 */
export function OpeningBalanceButton({ branches, methods }: { branches: Choice[]; methods: Choice[] }) {
  const t = useTranslations("cashBook");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LandmarkIcon />
        {t("opening.button")}
      </Button>
      {open && <OpeningDialog branches={branches} methods={methods} onClose={() => setOpen(false)} />}
    </>
  );
}

function OpeningDialog({ branches, methods, onClose }: { branches: Choice[]; methods: Choice[]; onClose: () => void }) {
  const t = useTranslations("cashBook.opening");
  const common = useTranslations("common");
  const router = useRouter();
  const timeZone = useTimeZone() ?? "UTC";
  const { pending, run } = useSubmit();
  const form = useForm<FormValues>({
    resolver: zodResolver(cashOpeningInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      branchId: branches.length === 1 ? branches[0]!.value : "",
      methodId: "",
      effectiveOn: formatDate(new Date(), timeZone),
      amount: "",
    },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => setCashOpeningAction(values as unknown as CashOpeningInput),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("saved"));
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
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <SelectField control={form.control} name="branchId" label={t("branch")} options={branches} />
            <SelectField control={form.control} name="methodId" label={t("method")} options={methods} />
            <TextField
              control={form.control}
              name="effectiveOn"
              label={t("effectiveOn")}
              placeholder={t("datePlaceholder")}
              inputMode="numeric"
            />
            <TextField
              control={form.control}
              name="amount"
              label={t("amount")}
              placeholder={t("amountPlaceholder")}
              inputMode="numeric"
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {common("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
