"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { StickyNoteIcon } from "lucide-react";
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
import { applyFieldErrors, TextField } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { contractNoteSchema } from "@flow/shared/contracts";
import { useSubmit } from "../admin/users/user-dialogs";
import { updateContractNoteAction } from "./actions";

/** "Update note" (brief §5.3): the note changes on any contract, also after approval. */
export function UpdateNoteButton({
  contract,
}: {
  contract: { id: string; contractCode: string; notes: string | null };
}) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <StickyNoteIcon />
        {t("updateNote")}
      </Button>
      {open && <NoteDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function NoteDialog({
  contract,
  onClose,
}: {
  contract: { id: string; contractCode: string; notes: string | null };
  onClose: () => void;
}) {
  const t = useTranslations("contracts");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<{ notes: string }>({
    resolver: zodResolver(contractNoteSchema, undefined, { raw: true }) as never,
    defaultValues: { notes: contract.notes ?? "" },
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => updateContractNoteAction(contract.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("noteSaved"));
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
            <DialogTitle>{t("noteTitle", { code: contract.contractCode })}</DialogTitle>
            <DialogDescription>{t("noteBody")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField control={form.control} name="notes" label={t("fields.notes")} multiline />
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
