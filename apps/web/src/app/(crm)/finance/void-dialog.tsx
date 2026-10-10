"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { voidSchema, type VoidInput } from "@flow/shared/finance";

type VoidDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** States the effect of voiding before the user confirms. */
  description: string;
  onVoid: (input: VoidInput) => Promise<ActionResult>;
  onVoided: () => void;
};

/** Voiding a payment or cash transaction: a confirmation that asks for the reason (A-008, A-009). */
export function VoidDialog({ open, onOpenChange, title, description, onVoid, onVoided }: VoidDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* Mounted only while open, so the reason starts empty each time. */}
        <VoidForm onVoid={onVoid} onVoided={onVoided} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function VoidForm({ onVoid, onVoided }: Pick<VoidDialogProps, "onVoid" | "onVoided">) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(voidSchema, undefined, { raw: true }) as never,
    defaultValues: { reason: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await onVoid(values);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("finance.voided"));
      onVoided();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <TextField
        control={form.control}
        name="reason"
        label={t("finance.voidReason")}
        placeholder={t("finance.voidReasonPlaceholder")}
        multiline
      />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={pending}>
          {t("finance.void")}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
