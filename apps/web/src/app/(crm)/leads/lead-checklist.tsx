"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon } from "lucide-react";
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
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { StatusBadge } from "@/components/status-badge";
import { offsetParts, showInputSchema, stepCompleteSchema, type Lead, type LeadStep } from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { completeLeadStepAction } from "./actions";
import { ShowFields, showDefaults, type ShowValues } from "./lead-visit";

const withShow = stepCompleteSchema.extend({ show: showInputSchema });
const withoutShow = stepCompleteSchema.omit({ show: true });
const emptyShow: ShowValues = {
  idDocumentType: "CCCD",
  idDocumentNumber: "",
  birthDate: "",
  nationality: "",
  email: "",
  phone: "",
  healthNote: "",
  consent: false,
};

type Labelled = { labelVi: string; labelEn: string };
type Trigger = Pick<LeadStep, "trigger" | "triggerStatus" | "triggerStepKey" | "offsetMinutes">;

/** A label in the user's language. */
export function useLabel(): (value: Labelled) => string {
  const locale = useLocale();
  return (value) => (locale === "vi" ? value.labelVi : value.labelEn);
}

/** When a step opens, in words: "60 phút sau khi được phân công", "3 giờ trước giờ hẹn" (D-020). */
export function useTriggerText(): (step: Trigger, steps: (Labelled & { key: string })[]) => string {
  const t = useTranslations("checklist.triggers");
  const tUnit = useTranslations("checklist.units");
  const tStatus = useTranslations("status.lead");
  const label = useLabel();
  return (step, steps) => {
    const { offsetValue, offsetUnit } = offsetParts(step.offsetMinutes);
    const delay = offsetValue === 0 ? "" : tUnit(offsetUnit, { count: offsetValue });
    switch (step.trigger) {
      case "ASSIGNED":
        return delay ? t("assigned", { delay }) : t("assignedNow");
      case "STATUS":
        return t(delay ? "status" : "statusNow", {
          delay,
          status: step.triggerStatus ? tStatus(step.triggerStatus) : "",
        });
      case "APPOINTMENT":
        return delay ? t("beforeAppointment", { delay }) : t("atAppointment");
      case "AFTER_STEP": {
        const previous = steps.find((s) => s.key === step.triggerStepKey);
        return t(delay ? "afterStep" : "afterStepNow", {
          delay,
          step: previous ? label(previous) : (step.triggerStepKey ?? ""),
        });
      }
      case "RECARE":
        return t("recare");
    }
  };
}

/** The lead's checklist (FR-LEAD-004): every step in order, what it waits for, its deadline or result. */
export function ChecklistSteps({ lead, steps, canComplete }: { lead: Lead; steps: LeadStep[]; canComplete: boolean }) {
  const t = useTranslations("checklist");
  const label = useLabel();
  const triggerText = useTriggerText();

  return (
    <ol className="divide-y">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3"
        >
          <div className="grid min-w-0 gap-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
              <span>{label(step)}</span>
              {step.required && <span className="text-xs font-normal text-muted-foreground">{t("required")}</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge entity="leadStep" status={step.state} />
              {step.state === "OPEN" && step.dueAt && (
                <span className={step.overdue ? "text-destructive" : undefined}>
                  {t("due")} <DateTime value={step.dueAt} format="dateTime" />
                </span>
              )}
              {step.overdue && <Badge variant="destructive">{t("overdue")}</Badge>}
              {step.state === "WAITING" && <span className="text-muted-foreground">{triggerText(step, steps)}</span>}
              {step.state === "DONE" && step.result && (
                <>
                  <span className="font-medium">{label(step.result)}</span>
                  {step.timing && <StatusBadge entity="stepTiming" status={step.timing} />}
                </>
              )}
            </div>
            {step.state === "DONE" && step.doneAt && (
              <p className="text-xs text-muted-foreground">
                <DateTime value={step.doneAt} format="dateTime" /> · {step.doneBy?.name}
              </p>
            )}
            {step.note && <p className="text-sm whitespace-pre-line text-muted-foreground">{step.note}</p>}
          </div>
          {canComplete && step.state === "OPEN" && (
            <CompleteStepButton leadId={lead.id} leadName={lead.fullName} step={step} lead={lead} />
          )}
        </li>
      ))}
    </ol>
  );
}

/** Records an open step's result (FR-LEAD-004); the note goes with it, never instead of it. */
export function CompleteStepButton({
  leadId,
  leadName,
  step,
  lead,
}: {
  leadId: string;
  leadName: string;
  step: LeadStep;
  /** Fills the Show details from what the lead already has. */
  lead?: Lead;
}) {
  const t = useTranslations();
  const router = useRouter();
  const label = useLabel();
  const [open, setOpen] = useState(false);
  const { pending, run } = useSubmit();
  const form = useForm<{ resultIndex: string; note: string; show: ShowValues }>({
    // The Show details are checked only when the chosen result converts the lead (D-019).
    resolver: (values, context, options) =>
      zodResolver(converts(values.resultIndex) ? withShow : withoutShow, undefined, { raw: true })(
        values as never,
        context,
        options as never,
      ) as never,
    defaultValues: {
      resultIndex: step.results.length === 1 ? "0" : "",
      note: "",
      show: lead ? showDefaults(lead, t("visit.vietnam")) : { ...emptyShow, nationality: "" },
    },
  });
  const converts = (resultIndex: string) => step.results[Number(resultIndex)]?.effect === "SHOW";
  const chosen = useWatch({ control: form.control, name: "resultIndex" });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () =>
        completeLeadStepAction(leadId, step.id, {
          resultIndex: values.resultIndex,
          note: values.note,
          ...(converts(values.resultIndex) ? { show: values.show as never } : {}),
        }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        if (converts(values.resultIndex)) {
          notify.success(t("visit.converted", { name: leadName }));
          return router.push(`/customers/${leadId}`);
        }
        notify.success(t("checklist.completed"));
        setOpen(false);
        router.refresh();
      },
    ),
  );

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label={t("checklist.completeLabel", { step: label(step) })}
      >
        <CheckIcon />
        {t("checklist.complete")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <DialogHeader>
              <DialogTitle>{label(step)}</DialogTitle>
              <DialogDescription>{t("checklist.completeDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <SelectField
                control={form.control}
                name="resultIndex"
                label={t("checklist.result")}
                options={step.results.map((result, index) => ({ value: String(index), label: label(result) }))}
              />
              {converts(chosen) && <ShowFields control={form.control} prefix="show." />}
              <TextField control={form.control} name="note" label={t("checklist.note")} multiline />
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("checklist.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
