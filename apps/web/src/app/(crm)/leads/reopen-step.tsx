"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Undo2Icon } from "lucide-react";
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
import { notify } from "@/components/notify";
import { OptionSelect } from "@/components/option-select";
import { stepReopenSchema, type LeadStep } from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { reopenLeadStepAction } from "./actions";

/**
 * Admin removes the tick of a step done by mistake (D-054): a reason from "stepReopenReasons" is needed,
 * and the removal stays in the history. A result that moved the lead cannot be removed (no button then).
 */
export function ReopenStepButton({ leadId, step, stepName }: { leadId: string; step: LeadStep; stepName: string }) {
  const t = useTranslations("checklist");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useSubmit();
  const form = useForm<{ reasonId: string; reasonNote: string }>({
    resolver: zodResolver(stepReopenSchema, undefined, { raw: true }) as never,
    defaultValues: { reasonId: "", reasonNote: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => reopenLeadStepAction(leadId, step.id, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("reopened", { step: stepName }));
        setOpen(false);
        router.refresh();
      },
    ),
  );

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={t("reopenFor", { step: stepName })}>
        <Undo2Icon />
        {t("reopen")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <DialogHeader>
              <DialogTitle>{t("reopenTitle", { step: stepName })}</DialogTitle>
              <DialogDescription>{t("reopenDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <OptionSelect
                control={form.control}
                name="reasonId"
                noteName="reasonNote"
                listKey="stepReopenReasons"
                label={t("reopenReason")}
              />
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : t("reopenConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
