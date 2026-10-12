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
import { OptionSelect } from "@/components/option-select";
import { StatusBadge } from "@/components/status-badge";
import {
  leadStatusChangeSchema,
  offsetParts,
  showInputSchema,
  stepCompleteSchema,
  type Lead,
  type LeadStep,
} from "@flow/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { completeLeadStepAction } from "./actions";
import { ShowFields, showDefaults, type ShowValues } from "./lead-visit";
import { ReopenStepButton } from "./reopen-step";

// Each result's own details are checked only when it is chosen; see the resolver.
const withShow = stepCompleteSchema.omit({ book: true, refuse: true }).extend({ show: showInputSchema });
const withoutShow = stepCompleteSchema.omit({ show: true, book: true, refuse: true });
const emptyShow: ShowValues = {
  idDocumentType: "CCCD",
  idDocumentNumber: "",
  birthDate: "",
  countryCode: "",
  email: "",
  phone: "",
  healthNote: "",
  consent: false,
};

const emptyBook = { appointmentDate: "", appointmentTime: "" };
const emptyRefuse = { refuseReasonId: "", refuseReasonNote: "" };

type StepEffect = LeadStep["results"][number]["effect"];

/**
 * The re-care results' own checks (BR-204): the same as the lead's status change, so the
 * appointment and the refusal reason are checked the way the status dialog checks them.
 */
function statusErrors(effect: "BOOK" | "REFUSE", values: { book: typeof emptyBook; refuse: typeof emptyRefuse }) {
  const parsed = leadStatusChangeSchema.safeParse(
    effect === "BOOK" ? { status: "BOOKED", ...values.book } : { status: "REFUSED", ...values.refuse },
  );
  const prefix = effect === "BOOK" ? "book" : "refuse";
  const errors: Record<string, Record<string, { type: string; message: string }>> = {};
  if (parsed.success) return errors;
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0]);
    if (field === "note") continue;
    errors[prefix] ??= {};
    errors[prefix][field] ??= { type: "validation", message: issue.message };
  }
  return errors;
}

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
export function ChecklistSteps({
  lead,
  steps,
  canComplete,
  canUntick = false,
}: {
  /** Null for the customer a lead became: the checklist is then only read (A-076). */
  lead: Lead | null;
  steps: LeadStep[];
  canComplete: boolean;
  /** Admin may remove a tick done by mistake (D-054). */
  canUntick?: boolean;
}) {
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
              {step.state === "NOT_DONE" && step.lockedAt && (
                <span className="text-muted-foreground">
                  {t("lockedAt")} <DateTime value={step.lockedAt} format="dateTime" />
                </span>
              )}
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
          {canComplete && lead && step.state === "OPEN" && (
            <CompleteStepButton leadId={lead.id} leadName={lead.fullName} step={step} lead={lead} />
          )}
          {canUntick && lead && step.state === "DONE" && step.reopenable && (
            <ReopenStepButton leadId={lead.id} step={step} stepName={label(step)} />
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
  const effectOf = (resultIndex: string): StepEffect => step.results[Number(resultIndex)]?.effect ?? null;
  const form = useForm<{
    resultIndex: string;
    note: string;
    show: ShowValues;
    book: typeof emptyBook;
    refuse: typeof emptyRefuse;
  }>({
    // The Show details are checked only when the chosen result converts the lead (D-019); the
    // appointment or the refusal reason only when it books or refuses the lead (BR-204).
    resolver: async (values, context, options) => {
      const effect = effectOf(values.resultIndex);
      const base = await zodResolver(effect === "SHOW" ? withShow : withoutShow, undefined, { raw: true })(
        values as never,
        context,
        options as never,
      );
      if (effect !== "BOOK" && effect !== "REFUSE") return base as never;
      const errors = statusErrors(effect, values);
      return (
        Object.keys(errors).length > 0 || Object.keys(base.errors).length > 0
          ? { values: {}, errors: { ...base.errors, ...errors } }
          : base
      ) as never;
    },
    defaultValues: {
      resultIndex: step.results.length === 1 ? "0" : "",
      note: "",
      show: lead ? showDefaults(lead) : emptyShow,
      book: emptyBook,
      refuse: emptyRefuse,
    },
  });
  const converts = (resultIndex: string) => effectOf(resultIndex) === "SHOW";
  const chosen = useWatch({ control: form.control, name: "resultIndex" });
  const effect = effectOf(chosen);
  const onSubmit = form.handleSubmit((values) =>
    run(
      () =>
        completeLeadStepAction(leadId, step.id, {
          resultIndex: values.resultIndex,
          note: values.note,
          ...(converts(values.resultIndex) ? { show: values.show as never } : {}),
          ...(effectOf(values.resultIndex) === "BOOK" ? { book: values.book } : {}),
          ...(effectOf(values.resultIndex) === "REFUSE" ? { refuse: values.refuse } : {}),
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
              {effect === "BOOK" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    control={form.control}
                    name="book.appointmentDate"
                    label={t("leads.fields.appointmentDate")}
                    placeholder={t("leads.datePlaceholder")}
                    autoComplete="off"
                  />
                  <TextField
                    control={form.control}
                    name="book.appointmentTime"
                    label={t("leads.fields.appointmentTime")}
                    placeholder={t("leads.timePlaceholder")}
                    inputMode="numeric"
                  />
                </div>
              )}
              {effect === "REFUSE" && (
                <OptionSelect
                  control={form.control}
                  name="refuse.refuseReasonId"
                  noteName="refuse.refuseReasonNote"
                  listKey="leadRefuseReasons"
                  label={t("leads.fields.refuseReason")}
                />
              )}
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
