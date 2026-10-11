"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { contractInputSchema, type ContractInput } from "@flow/shared/contracts";

export type ContractFormValues = {
  packageName: string;
  contractValue: string;
  totalSessions: string;
  startDate: string;
  endDate: string;
};

type ContractFormProps = {
  defaultValues: ContractFormValues;
  submit: (values: ContractInput) => Promise<ActionResult<unknown>>;
  onSaved: (result: unknown) => void;
  onCancel: () => void;
};

export function ContractForm({ defaultValues, submit, onSaved, onCancel }: ContractFormProps) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  // Same schema as the server for instant feedback; raw values are sent and re-parsed there.
  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractInputSchema, undefined, { raw: true }) as never,
    defaultValues,
  });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await submit(values);
      if (result.ok) return onSaved(result.data);
      applyFieldErrors(form.setError, result.fieldErrors);
      notify.error(errorMessage(result.code));
    }),
  );

  const fields = "contracts.fields" as const;
  return (
    <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
      <FieldGroup className="flex-1 overflow-y-auto px-4">
        <TextField control={form.control} name="packageName" label={t(`${fields}.packageName`)} autoComplete="off" />
        <TextField
          control={form.control}
          name="contractValue"
          label={t(`${fields}.contractValue`)}
          placeholder={t("contracts.valuePlaceholder")}
          inputMode="numeric"
        />
        <TextField
          control={form.control}
          name="totalSessions"
          label={t(`${fields}.totalSessions`)}
          inputMode="numeric"
        />
        <TextField
          control={form.control}
          name="startDate"
          label={t(`${fields}.startDate`)}
          placeholder={t("contracts.datePlaceholder")}
          inputMode="numeric"
        />
        <TextField
          control={form.control}
          name="endDate"
          label={t(`${fields}.endDate`)}
          placeholder={t("contracts.datePlaceholder")}
          inputMode="numeric"
        />
      </FieldGroup>
      <div className="flex justify-end gap-2 border-t p-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
