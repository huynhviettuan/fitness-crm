"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import type { ActionResult } from "@/lib/actions/result";
import { useSubmit } from "../users/user-dialogs";

/** The dialog every catalog entry is added and edited in: the fields, a save button, and the saved/refused answers (M7.1). */
export function CatalogDialog<T extends FieldValues>({
  title,
  form,
  save,
  onClose,
  children,
}: {
  title: string;
  form: UseFormReturn<T>;
  /** Saves the form's values. */
  save: (values: T) => Promise<ActionResult>;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("workoutCatalog");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => save(values),
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? common("saving") : common("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
