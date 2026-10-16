"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { SelectField, SwitchField, TextField } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { NO_OPTION } from "@/components/option-select";
import {
  OFFSET_UNITS,
  RESULT_EFFECTS,
  STEP_ACTIONS,
  STEP_TRIGGERS,
  STEP_TRIGGER_STATUSES,
  checklistInputSchema,
  offsetParts,
  type Checklist,
  type ChecklistInput,
} from "@gymcrm/shared/leads";
import { useLabel } from "../../leads/lead-checklist";
import { saveChecklistAction } from "./actions";

type Values = { steps: (Omit<ChecklistInput["steps"][number], "offsetValue"> & { offsetValue: string })[] };

const newKey = () => `buoc-${Math.random().toString(36).slice(2, 8)}`;

/** A drop-down cannot hold "", so "none" (no effect, no action) is NO_OPTION on screen. */
const fromForm = (values: Values): Values => ({
  steps: values.steps.map((step) => ({
    ...step,
    action: step.action === NO_OPTION ? "" : step.action,
    results: step.results.map((result) => ({ ...result, effect: result.effect === NO_OPTION ? "" : result.effect })),
  })),
});

/**
 * The checklist as a form (D-020): steps in order, each with its names, what opens it,
 * its delay, whether it is required or done by what opens it, and its results. Saving makes the next version;
 * leads already started keep theirs.
 */
export function ChecklistEditor({ checklist }: { checklist: Checklist }) {
  const t = useTranslations("checklistAdmin");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const form = useForm<Values>({
    resolver: (values, context, options) =>
      zodResolver(checklistInputSchema, undefined, { raw: true })(
        fromForm(values) as never,
        context,
        options as never,
      ) as never,
    defaultValues: {
      steps: checklist.steps.map((step) => {
        const { offsetValue, offsetUnit } = offsetParts(step.offsetMinutes);
        return {
          key: step.key,
          labelVi: step.labelVi,
          labelEn: step.labelEn,
          trigger: step.trigger,
          triggerStatus: step.triggerStatus ?? "",
          triggerStepKey: step.triggerStepKey ?? "",
          offsetValue: String(offsetValue),
          offsetUnit,
          required: step.required,
          autoComplete: step.autoComplete,
          action: step.action ?? NO_OPTION,
          results: step.results.map((result) => ({ ...result, effect: result.effect ?? NO_OPTION })),
        };
      }),
    },
  });
  const steps = useFieldArray({ control: form.control, name: "steps" });
  const onSubmit = form.handleSubmit(async (values) => {
    const result = await saveChecklistAction(fromForm(values) as unknown as ChecklistInput);
    if (!result.ok) return void notify.error(errorMessage(result.code));
    notify.success(t("saved", { version: result.data.version }));
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {steps.fields.map((field, index) => (
        <FieldSet key={field.id} className="rounded-lg border p-4" aria-label={t("stepLegend", { number: index + 1 })}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLegend>{t("stepLegend", { number: index + 1 })}</FieldLegend>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("moveUp")}
                disabled={index === 0}
                onClick={() => steps.move(index, index - 1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("moveDown")}
                disabled={index === steps.fields.length - 1}
                onClick={() => steps.move(index, index + 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("remove")}
                disabled={steps.fields.length === 1}
                onClick={() => steps.remove(index)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
          <StepFields control={form.control} index={index} />
        </FieldSet>
      ))}
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            steps.append({
              key: newKey(),
              labelVi: "",
              labelEn: "",
              trigger: "AFTER_STEP",
              triggerStatus: "",
              triggerStepKey: "",
              offsetValue: "0",
              offsetUnit: "MINUTES",
              required: true,
              autoComplete: false,
              action: NO_OPTION,
              results: [{ labelVi: "Done", labelEn: "Done", effect: NO_OPTION }],
            })
          }
        >
          <PlusIcon />
          {t("addStep")}
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? tCommon("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

function StepFields({ control, index }: { control: Control<Values>; index: number }) {
  const t = useTranslations("checklistAdmin");
  const tTrigger = useTranslations("checklistAdmin.triggerKinds");
  const tUnit = useTranslations("checklistAdmin.unitNames");
  const tStatus = useTranslations("status.lead");
  const label = useLabel();
  const trigger = useWatch({ control, name: `steps.${index}.trigger` });
  const earlier = useWatch({ control, name: "steps" }).slice(0, index);
  const results = useFieldArray({ control, name: `steps.${index}.results` });

  return (
    <FieldGroup className="mt-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={control} name={`steps.${index}.labelVi`} label={t("labelVi")} autoComplete="off" />
        <TextField control={control} name={`steps.${index}.labelEn`} label={t("labelEn")} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          control={control}
          name={`steps.${index}.trigger`}
          label={t("trigger")}
          options={STEP_TRIGGERS.map((value) => ({ value, label: tTrigger(value) }))}
        />
        {trigger === "STATUS" && (
          <SelectField
            control={control}
            name={`steps.${index}.triggerStatus`}
            label={t("triggerStatus")}
            options={STEP_TRIGGER_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
          />
        )}
        {trigger === "AFTER_STEP" && (
          <SelectField
            control={control}
            name={`steps.${index}.triggerStepKey`}
            label={t("triggerStep")}
            options={earlier.filter((step) => step.labelVi).map((step) => ({ value: step.key, label: label(step) }))}
          />
        )}
        {trigger !== "RECARE" && (
          <div className="grid grid-cols-2 gap-2">
            <TextField
              control={control}
              name={`steps.${index}.offsetValue`}
              label={trigger === "APPOINTMENT" ? t("offsetBefore") : t("offset")}
              inputMode="numeric"
            />
            <SelectField
              control={control}
              name={`steps.${index}.offsetUnit`}
              label={t("unit")}
              options={OFFSET_UNITS.map((value) => ({ value, label: tUnit(value) }))}
            />
          </div>
        )}
      </div>
      {trigger === "RECARE" && <p className="text-sm text-muted-foreground">{t("recareHint")}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          control={control}
          name={`steps.${index}.action`}
          label={t("action")}
          description={t("actionHint")}
          options={[
            { value: NO_OPTION, label: t("noAction") },
            ...STEP_ACTIONS.map((value) => ({ value, label: t(`actions.${value}`) })),
          ]}
        />
        <SwitchField control={control} name={`steps.${index}.required`} label={t("required")} />
        <SwitchField
          control={control}
          name={`steps.${index}.autoComplete`}
          label={t("autoComplete")}
          description={t("autoCompleteHint")}
        />
      </div>
      <FieldSet>
        <FieldLegend variant="label">{t("results")}</FieldLegend>
        {results.fields.map((result, resultIndex) => (
          <div
            key={result.id}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]"
          >
            <TextField
              control={control}
              name={`steps.${index}.results.${resultIndex}.labelVi`}
              label={t("resultVi", { number: resultIndex + 1 })}
              autoComplete="off"
            />
            <TextField
              control={control}
              name={`steps.${index}.results.${resultIndex}.labelEn`}
              label={t("resultEn", { number: resultIndex + 1 })}
              autoComplete="off"
            />
            <div className="col-span-2 sm:col-span-1">
              <SelectField
                control={control}
                name={`steps.${index}.results.${resultIndex}.effect`}
                label={t("resultEffect", { number: resultIndex + 1 })}
                options={[
                  { value: NO_OPTION, label: t("noEffect") },
                  ...RESULT_EFFECTS.map((value) => ({ value, label: t(`effects.${value}`) })),
                ]}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("removeResult", { number: resultIndex + 1 })}
              disabled={results.fields.length === 1}
              onClick={() => results.remove(resultIndex)}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={results.fields.length >= 10}
            onClick={() => results.append({ labelVi: "", labelEn: "", effect: NO_OPTION })}
          >
            <PlusIcon />
            {t("addResult")}
          </Button>
        </div>
      </FieldSet>
    </FieldGroup>
  );
}
