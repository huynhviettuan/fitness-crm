"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FlameIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { OptionSelect } from "@/components/option-select";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { burnShowSchema } from "@flow/shared/bookings";
import { burnShowAction } from "./actions";
import { CustomerPicker, useBookableContracts } from "./booking-form";
import type { TrainerOption } from "./booking-types";

type BurnShowValues = {
  customerId: string;
  contractId: string;
  trainerId: string;
  date: string;
  startTime: string;
  endTime: string;
  reasonId: string;
  reasonNote: string;
};

/** Burn Show (D-028): admin adds a trained session by hand, with a reason. */
export function BurnShowButton({ trainers }: { trainers: TrainerOption[] }) {
  const t = useTranslations("bookings");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FlameIcon />
        {t("burn")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("burnTitle")}</DialogTitle>
            <DialogDescription>{t("burnDescription")}</DialogDescription>
          </DialogHeader>
          {/* Mounted only while open, so every opening starts from fresh values. */}
          <BurnShowForm trainers={trainers} onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function BurnShowForm({ trainers, onClose }: { trainers: TrainerOption[]; onClose: () => void }) {
  const t = useTranslations("bookings");
  const common = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<BurnShowValues>({
    resolver: zodResolver(burnShowSchema, undefined, { raw: true }) as never,
    defaultValues: {
      customerId: "",
      contractId: "",
      trainerId: trainers.length === 1 ? trainers[0].id : "",
      date: "",
      startTime: "",
      endTime: "",
      reasonId: "",
      reasonNote: "",
    },
  });
  const customerId = useWatch({ control: form.control, name: "customerId" });
  const contracts = useBookableContracts(customerId);

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      // The customer comes from the contract; the API does not take it.
      const result = await burnShowAction({
        contractId: values.contractId,
        trainerId: values.trainerId,
        date: values.date,
        startTime: values.startTime,
        endTime: values.endTime,
        reasonId: values.reasonId,
        reasonNote: values.reasonNote,
      });
      if (!result.ok) {
        applyFieldErrors(form.setError, result.fieldErrors);
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("burned", { remaining: result.data.remaining }));
      onClose();
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <FieldGroup>
        <CustomerPicker control={form.control} onPicked={() => form.setValue("contractId", "")} />
        {customerId && contracts?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noBookableContracts")}</p>
        ) : (
          <SelectField
            control={form.control}
            name="contractId"
            label={t("fields.contract")}
            placeholder={t("choose")}
            options={(contracts ?? []).map((c) => ({
              value: c.id,
              label: t("contractOption", {
                code: c.contractCode,
                package: c.packageName,
                remaining: c.remainingSessions,
              }),
            }))}
          />
        )}
        <SelectField
          control={form.control}
          name="trainerId"
          label={t("fields.trainer")}
          placeholder={t("choose")}
          options={trainers.map((trainer) => ({
            value: trainer.id,
            label: `${trainer.fullName} · ${trainer.employeeCode}`,
          }))}
        />
        <TextField
          control={form.control}
          name="date"
          label={t("fields.date")}
          placeholder={t("datePlaceholder")}
          inputMode="numeric"
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            control={form.control}
            name="startTime"
            label={t("fields.startTime")}
            placeholder={t("timePlaceholder")}
            inputMode="numeric"
          />
          <TextField
            control={form.control}
            name="endTime"
            label={t("fields.endTime")}
            placeholder={t("timePlaceholder")}
            inputMode="numeric"
          />
        </div>
        <OptionSelect
          control={form.control}
          name="reasonId"
          noteName="reasonNote"
          listKey="burnShowReasons"
          label={t("burnReason")}
        />
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
