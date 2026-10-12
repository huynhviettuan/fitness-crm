"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { leadNoteInputSchema } from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { addLeadNoteAction } from "./actions";

/** Adds a note to the lead's timeline (A-074): dated, with the author, never edited. */
export function AddLeadNote({ leadId }: { leadId: string }) {
  const t = useTranslations("leads.notes");
  const tc = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<{ body: string }>({
    resolver: zodResolver(leadNoteInputSchema, undefined, { raw: true }) as never,
    defaultValues: { body: "" },
  });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => addLeadNoteAction(leadId, values),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("saved"));
        form.reset();
        router.refresh();
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="mb-6 space-y-2" aria-label={t("title")}>
      <TextField control={form.control} name="body" label={t("title")} placeholder={t("placeholder")} multiline />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? tc("saving") : t("add")}
        </Button>
      </div>
    </form>
  );
}
