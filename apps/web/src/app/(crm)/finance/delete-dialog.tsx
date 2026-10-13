"use client";

import { useState, useTransition } from "react";
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
import type { Dependents } from "@/lib/api/errors";
import { deleteSchema, type DeleteInput } from "@flow/shared/trash";

type DeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** States the effect of deleting before the user confirms. */
  description: string;
  onDelete: (input: DeleteInput) => Promise<ActionResult<{ submitted: boolean }>>;
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
  // A contract with receipts or sessions is not deleted: they are listed so they can be dealt with first (D-022).
  const [blockedBy, setBlockedBy] = useState<Dependents>([]);
  const form = useForm<{ reasonId: string; reasonNote: string }>({
    resolver: zodResolver(deleteSchema, undefined, { raw: true }) as never,
    defaultValues: { reasonId: "", reasonNote: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await onDelete(values);
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        setBlockedBy(result.dependents ?? []);
        notify.error(errorMessage(result.code));
        return;
      }
      // Under the approval matrix the record stays until an approver agrees (D-018).
      notify.success(result.data.submitted ? t("approvals.submitted") : t("finance.deleted"));
      onDeleted();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <OptionSelect
        control={form.control}
        name="reasonId"
        noteName="reasonNote"
        listKey="deleteReasons"
        label={t("finance.deleteReason")}
      />
      {blockedBy.length > 0 && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{t("common.blockedBy")}</p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
            {blockedBy.map((row) => (
              <li key={row.id} className="flex justify-between gap-4 tabular-nums">
                <span>{t(`common.dependentKinds.${row.kind}`)}</span>
                <span className="text-muted-foreground">{row.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
        <Button type="submit" variant="destructive" disabled={pending}>
          {t("finance.delete")}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
