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
import { applyFieldErrors } from "@/components/form-fields";
import { OptionSelect } from "@/components/option-select";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { deleteSchema, type DeleteInput } from "@flow/shared/trash";

type DeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** States the effect of deleting before the user confirms. */
  description: string;
  onDelete: (input: DeleteInput) => Promise<ActionResult>;
  onDeleted: () => void;
};

/**
 * Deleting a record to the trash (D-035): a confirmation that asks for the reason from
 * the "deleteReasons" list (D-016).
 */
export function DeleteDialog({ open, onOpenChange, title, description, onDelete, onDeleted }: DeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* Mounted only while open, so the reason starts empty each time. */}
        <DeleteForm onDelete={onDelete} onDeleted={onDeleted} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteForm({ onDelete, onDeleted }: Pick<DeleteDialogProps, "onDelete" | "onDeleted">) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<{ reasonId: string; reasonNote: string }>({
    resolver: zodResolver(deleteSchema, undefined, { raw: true }) as never,
    defaultValues: { reasonId: "", reasonNote: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await onDelete(values);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("finance.deleted"));
      onDeleted();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <OptionSelect control={form.control} name="reasonId" noteName="reasonNote" listKey="deleteReasons" label={t("finance.deleteReason")} />
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={pending}>
          {t("finance.delete")}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
