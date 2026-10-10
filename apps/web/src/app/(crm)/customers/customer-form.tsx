"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "@flow/shared/customers";

export type CustomerFormValues = {
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
};

type CustomerFormProps = {
  mode: "create" | "edit";
  defaultValues: CustomerFormValues;
  /** The Server Action to call with the raw form values. */
  submit: (values: CreateCustomerInput & UpdateCustomerInput) => Promise<ActionResult<unknown>>;
  onSaved: (result: unknown) => void;
  onCancel: () => void;
};

export function CustomerForm({ mode, defaultValues, submit, onSaved, onCancel }: CustomerFormProps) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();

  // The same schema the server uses gives instant feedback. Raw values are sent so
  // the server parses (and trusts) only its own transformation.
  const resolver =
    mode === "create"
      ? zodResolver(createCustomerSchema, undefined, { raw: true })
      : zodResolver(updateCustomerSchema, undefined, { raw: true });
  const form = useForm<CustomerFormValues>({ resolver: resolver as never, defaultValues });

  const onSubmit = form.handleSubmit((values) => {
    const { status, ...fields } = values;
    startTransition(async () => {
      const result = await submit(mode === "create" ? fields : { ...fields, status });
      if (result.ok) return onSaved(result.data);
      applyFieldErrors(form.setError, result.fieldErrors);
      notify.error(errorMessage(result.code));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
      <FieldGroup className="flex-1 overflow-y-auto px-4">
        <TextField control={form.control} name="fullName" label={t("customers.fields.fullName")} autoComplete="off" />
        <TextField
          control={form.control}
          name="phone"
          label={t("customers.fields.phone")}
          type="tel"
          inputMode="tel"
          placeholder={t("customers.phonePlaceholder")}
        />
        <TextField control={form.control} name="email" label={t("customers.fields.email")} type="email" />
        <TextField
          control={form.control}
          name="dateOfBirth"
          label={t("customers.fields.dateOfBirth")}
          placeholder={t("customers.dateOfBirthPlaceholder")}
          inputMode="numeric"
        />
        {mode === "edit" && (
          <SelectField
            control={form.control}
            name="status"
            label={t("customers.fields.status")}
            options={(["ACTIVE", "INACTIVE"] as const).map((value) => ({
              value,
              label: t(`status.customer.${value}`),
            }))}
          />
        )}
        <TextField control={form.control} name="notes" label={t("customers.fields.notes")} multiline />
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
