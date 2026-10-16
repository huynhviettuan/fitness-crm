"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PlusIcon, PencilIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import {
  CheckboxField,
  SelectField,
  SwitchField,
  TextField,
  applyFieldErrors,
  useValidationMessage,
} from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { classInputSchema, classUpdateSchema, WEEKDAYS, type GymClass } from "@gymcrm/shared/classes";
import type { TrainerOption } from "../bookings/booking-types";
import { createClassAction, updateClassAction } from "./actions";

type Values = {
  name: string;
  branchId: string;
  coachId: string;
  capacity: string;
  startTime: string;
  endTime: string;
  active: boolean;
  day1: boolean;
  day2: boolean;
  day3: boolean;
  day4: boolean;
  day5: boolean;
  day6: boolean;
  day7: boolean;
};

type Props = {
  trainers: TrainerOption[];
  branches: { id: string; name: string }[];
  /** The branch of each trainer, so the coach list follows the branch chosen. */
  branchOf: Record<string, string>;
};

/** The add button and the edit buttons of the class definitions (FR-CLS-001). */
export function ClassFormButton({ gymClass, ...props }: Props & { gymClass?: GymClass }) {
  const t = useTranslations("classes");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={gymClass ? "outline" : "default"}
        size={gymClass ? "sm" : "default"}
        onClick={() => setOpen(true)}
      >
        {gymClass ? <PencilIcon /> : <PlusIcon />}
        {gymClass ? t("edit") : t("add")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{gymClass ? t("editTitle", { name: gymClass.name }) : t("add")}</DialogTitle>
            <DialogDescription>{gymClass ? t("editDescription") : t("addDescription")}</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so every opening starts from fresh values. */}
          <ClassForm {...props} gymClass={gymClass} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClassForm({
  gymClass,
  trainers,
  branches,
  branchOf,
  onClose,
}: Props & { gymClass?: GymClass; onClose: () => void }) {
  const t = useTranslations("classes");
  const common = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const editing = gymClass !== undefined;
  const form = useForm<Values>({
    // The day checkboxes become the list of weekdays the schema validates.
    resolver: ((values: Values, context: unknown, options: never) =>
      zodResolver((editing ? classUpdateSchema : classInputSchema) as never, undefined, { raw: true })(
        { ...values, weekdays: WEEKDAYS.filter((day) => values[`day${day}` as keyof Values] === true) } as never,
        context as never,
        options,
      )) as never,
    defaultValues: {
      name: gymClass?.name ?? "",
      branchId: gymClass?.branch.id ?? (branches.length === 1 ? branches[0].id : ""),
      coachId: gymClass?.coach.id ?? "",
      capacity: String(gymClass?.capacity ?? 20),
      startTime: gymClass?.startTime ?? "",
      endTime: gymClass?.endTime ?? "",
      active: gymClass?.active ?? true,
      ...Object.fromEntries(WEEKDAYS.map((day) => [`day${day}`, gymClass?.weekdays.includes(day) ?? false])),
    } as Values,
  });
  const branchId = useWatch({ control: form.control, name: "branchId" });
  const validationMessage = useValidationMessage();
  const weekdaysError = (form.formState.errors as Record<string, { message?: string } | undefined>).weekdays?.message;
  const coaches = trainers.filter((trainer) => !branchId || branchOf[trainer.id] === branchId);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const weekdays = WEEKDAYS.filter((day) => values[`day${day}` as keyof Values] === true);
      const result = gymClass
        ? await updateClassAction(gymClass.id, {
            name: values.name,
            coachId: values.coachId,
            capacity: Number(values.capacity),
            active: values.active,
          })
        : await createClassAction({
            name: values.name,
            branchId: values.branchId,
            coachId: values.coachId,
            capacity: Number(values.capacity),
            weekdays,
            startTime: values.startTime,
            endTime: values.endTime,
          });
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t(editing ? "saved" : "created"));
      onClose();
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        <TextField control={form.control} name="name" label={t("fields.name")} />
        {!editing && (
          <SelectField
            control={form.control}
            name="branchId"
            label={t("fields.branch")}
            placeholder={t("choose")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <SelectField
          control={form.control}
          name="coachId"
          label={t("fields.coach")}
          placeholder={t("choose")}
          options={coaches.map((trainer) => ({
            value: trainer.id,
            label: `${trainer.fullName} · ${trainer.employeeCode}`,
          }))}
        />
        <TextField control={form.control} name="capacity" label={t("fields.capacity")} inputMode="numeric" />
        {!editing && (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("fields.weekdays")}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {WEEKDAYS.map((day) => (
                  <CheckboxField
                    key={day}
                    control={form.control}
                    name={`day${day}` as keyof Values}
                    label={t(`weekdays.${day}`)}
                  />
                ))}
              </div>
              {weekdaysError && <p className="text-sm text-destructive">{validationMessage(weekdaysError)}</p>}
            </fieldset>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                control={form.control}
                name="startTime"
                label={t("fields.startTime")}
                placeholder="hh:mm"
                inputMode="numeric"
              />
              <TextField
                control={form.control}
                name="endTime"
                label={t("fields.endTime")}
                placeholder="hh:mm"
                inputMode="numeric"
              />
            </div>
          </>
        )}
        {editing && (
          <SwitchField control={form.control} name="active" label={t("fields.active")} description={t("activeHint")} />
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {common("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? common("saving") : common("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A class's days as short names, in order. */
export function WeekdayBadges({ weekdays }: { weekdays: number[] }) {
  const t = useTranslations("classes");
  return (
    <span className="flex flex-wrap gap-1">
      {weekdays.map((day) => (
        <Badge key={day} variant="muted">
          {t(`weekdaysShort.${day as 1}`)}
        </Badge>
      ))}
    </span>
  );
}
