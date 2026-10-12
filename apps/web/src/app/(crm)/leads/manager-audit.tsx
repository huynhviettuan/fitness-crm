"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { DateTime } from "@/components/date-time";
import { CheckboxListField, SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { optionLabel } from "@/components/option-select";
import { useOptions } from "@/components/use-options";
import { managerAuditInputSchema, type ManagerAudit } from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { addManagerAuditAction } from "./actions";

/**
 * The manager's audit of a lead (FR-LEAD-011, A-086, A-087): the latest grade, with its comment
 * and the criteria not met, the earlier grades below it, and for a manager the button to grade.
 */
export function ManagerAuditPanel({
  leadId,
  leadName,
  audits,
  canGrade,
}: {
  leadId: string;
  leadName: string;
  audits: ManagerAudit[];
  canGrade: boolean;
}) {
  const t = useTranslations("leadAudit.manager");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [latest, ...earlier] = audits;

  const entry = (audit: ManagerAudit) => (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={audit.result === "PASS" ? "success" : "destructive"}>{t(`result.${audit.result}`)}</Badge>
        <span className="text-xs text-muted-foreground">
          <DateTime value={audit.at} format="dateTime" /> · {audit.auditor.name}
        </span>
      </div>
      {audit.criteria.length > 0 && (
        <p>
          {t("notMet")}: {audit.criteria.map((criterion) => optionLabel(criterion, locale)).join(", ")}
        </p>
      )}
      {audit.comment && <p className="whitespace-pre-line text-muted-foreground">{audit.comment}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      {latest ? entry(latest) : <p className="text-sm text-muted-foreground">{t("none")}</p>}
      {earlier.length > 0 && (
        <section aria-label={t("earlier")} className="space-y-3 border-t pt-3">
          <h3 className="text-sm font-medium">{t("earlier")}</h3>
          <ul className="space-y-3">
            {earlier.map((audit) => (
              <li key={audit.id}>{entry(audit)}</li>
            ))}
          </ul>
        </section>
      )}
      {canGrade && (
        <>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <ClipboardCheckIcon />
            {latest ? t("gradeAgain") : t("grade")}
          </Button>
          {open && <GradeDialog leadId={leadId} leadName={leadName} onClose={() => setOpen(false)} />}
        </>
      )}
    </div>
  );
}

type GradeValues = { result: "PASS" | "FAIL"; criterionIds: string[]; comment: string };

function GradeDialog({ leadId, leadName, onClose }: { leadId: string; leadName: string; onClose: () => void }) {
  const t = useTranslations("leadAudit.manager");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const options = useOptions("auditFailReasons");
  const form = useForm<GradeValues>({
    resolver: zodResolver(managerAuditInputSchema as never, undefined, { raw: true }) as never,
    defaultValues: { result: "PASS", criterionIds: [], comment: "" },
  });
  const result = useWatch({ control: form.control, name: "result" });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () =>
        addManagerAuditAction(leadId, { ...values, criterionIds: values.result === "FAIL" ? values.criterionIds : [] }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("saved"));
        onClose();
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("gradeTitle", { name: leadName })}</DialogTitle>
            <DialogDescription>{t("gradeDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <SelectField
              control={form.control}
              name="result"
              label={t("resultLabel")}
              options={(["PASS", "FAIL"] as const).map((value) => ({ value, label: t(`result.${value}`) }))}
            />
            {result === "FAIL" && (
              <CheckboxListField
                control={form.control}
                name="criterionIds"
                label={t("notMet")}
                options={(options ?? []).map((option) => ({ value: option.id, label: optionLabel(option, locale) }))}
              />
            )}
            <TextField control={form.control} name="comment" label={t("comment")} multiline />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
