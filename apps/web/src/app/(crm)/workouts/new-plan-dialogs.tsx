"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PlusIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { planCreateSchema } from "@flow/shared/workouts";
import { useSubmit } from "../admin/users/user-dialogs";
import { createPlanAction } from "./actions";

const NONE = "none";

/** The dialog both buttons open: the fields, and the save that opens the plan it made. */
function CreateDialog<T extends Record<string, string>>({
  title,
  form,
  toInput,
  onClose,
  children,
}: {
  title: string;
  form: ReturnType<typeof useForm<T>>;
  toInput: (values: T) => Parameters<typeof createPlanAction>[0];
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("workoutPlans");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => createPlanAction(toInput(values)),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      ({ id }) => {
        notify.success(t("created"));
        router.push(`/workouts/plans/${id}`);
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
              {pending ? common("saving") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A new template (a draft the coach fills in), opened in its editor (M7.2). */
export function NewTemplateButton() {
  const t = useTranslations("workoutPlans");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("newTemplate")}
      </Button>
      {open && <NewTemplateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function NewTemplateDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("workoutPlans");
  const form = useForm<{ name: string; notes: string }>({
    resolver: ((values: { name: string; notes: string }, context: unknown, options: never) =>
      zodResolver(planCreateSchema as never, undefined, { raw: true })(
        { kind: "TEMPLATE", branchId: "", ...values } as never,
        context as never,
        options,
      )) as never,
    defaultValues: { name: "", notes: "" },
  });
  return (
    <CreateDialog
      title={t("newTemplate")}
      form={form}
      toInput={(values) => ({ kind: "TEMPLATE", branchId: "", ...values })}
      onClose={onClose}
    >
      <TextField control={form.control} name="name" label={t("fields.name")} autoComplete="off" />
      <TextField control={form.control} name="notes" label={t("fields.notes")} multiline />
    </CreateDialog>
  );
}

type Values = {
  contractId: string;
  templateId: string;
  trainerId: string;
  name: string;
  weeksPerStage: string;
  sessionsPerWeek: string;
};

/** A new plan for a customer, blank or from an approved template (M7.2, brief §7.2). */
export function NewPlanButton({
  customerId,
  contracts,
  templates,
  trainers,
}: {
  customerId: string;
  contracts: { id: string; label: string }[];
  templates: { id: string; name: string }[];
  /** Null for a PT, whose plan is their own. */
  trainers: { id: string; name: string }[] | null;
}) {
  const t = useTranslations("workoutPlans");
  const [open, setOpen] = useState(false);
  if (contracts.length === 0) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("newPlan")}
      </Button>
      {open && (
        <NewPlanDialog
          customerId={customerId}
          contracts={contracts}
          templates={templates}
          trainers={trainers}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NewPlanDialog({
  customerId,
  contracts,
  templates,
  trainers,
  onClose,
}: {
  customerId: string;
  contracts: { id: string; label: string }[];
  templates: { id: string; name: string }[];
  trainers: { id: string; name: string }[] | null;
  onClose: () => void;
}) {
  const t = useTranslations("workoutPlans");
  const toInput = (values: Values) => ({
    kind: "CUSTOMER" as const,
    customerId,
    contractId: values.contractId,
    trainerId: values.trainerId === NONE ? "" : values.trainerId,
    templateId: values.templateId === NONE ? "" : values.templateId,
    name: values.name,
    weeksPerStage: values.weeksPerStage,
    sessionsPerWeek: values.sessionsPerWeek,
  });
  const form = useForm<Values>({
    resolver: ((values: Values, context: unknown, options: never) =>
      zodResolver(planCreateSchema as never, undefined, { raw: true })(
        toInput(values) as never,
        context as never,
        options,
      )) as never,
    defaultValues: {
      contractId: contracts.length === 1 ? contracts[0]!.id : "",
      templateId: NONE,
      trainerId: NONE,
      name: "",
      weeksPerStage: "4",
      sessionsPerWeek: "3",
    },
  });
  const template = useWatch({ control: form.control, name: "templateId" });
  return (
    <CreateDialog title={t("newPlan")} form={form} toInput={toInput} onClose={onClose}>
      <SelectField
        control={form.control}
        name="contractId"
        label={t("fields.contract")}
        options={contracts.map((contract) => ({ value: contract.id, label: contract.label }))}
      />
      {trainers && (
        <SelectField
          control={form.control}
          name="trainerId"
          label={t("fields.trainer")}
          options={trainers.map((trainer) => ({ value: trainer.id, label: trainer.name }))}
        />
      )}
      <SelectField
        control={form.control}
        name="templateId"
        label={t("fields.template")}
        options={[
          { value: NONE, label: t("blank") },
          ...templates.map((item) => ({ value: item.id, label: item.name })),
        ]}
      />
      {template !== NONE && (
        <div className="grid grid-cols-2 gap-4">
          <TextField
            control={form.control}
            name="weeksPerStage"
            label={t("fields.weeksPerStage")}
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="sessionsPerWeek"
            label={t("fields.sessionsPerWeek")}
            inputMode="numeric"
          />
        </div>
      )}
      <TextField control={form.control} name="name" label={t("fields.nameOptional")} autoComplete="off" />
    </CreateDialog>
  );
}
