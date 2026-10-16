"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { z } from "zod";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { NO_OPTION, OptionSelect } from "@/components/option-select";
import { notify } from "@/components/notify";
import { DuplicateNotice } from "@/components/duplicate-notice";
import type { DuplicatePerson } from "@/lib/api/errors";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from "@gymcrm/shared/customers";

export type CustomerFormValues = {
  branchId: string;
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  notes: string;
  status: "ACTIVE" | "INACTIVE";
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  customerGroupId: string;
  customerGroupNote: string;
  staffInChargeId: string;
};

/** Select items cannot be empty, so "none" has its own value; it is sent as "" (D-016). */
const fromNone = (values: unknown) =>
  Object.fromEntries(
    Object.entries(values as Record<string, unknown>).map(([key, value]) => [key, value === NO_OPTION ? "" : value]),
  );

type CustomerFormProps = {
  mode: "create" | "edit";
  defaultValues: CustomerFormValues;
  /** Branches to choose from when creating; with one, it is used without asking (D-014). */
  branches?: { id: string; name: string }[];
  /** Fields hidden from this user (D-017): not shown, and not sent. */
  masked?: ("phone" | "email" | "address")[];
  /** Who can be in charge of the customer (A-071). */
  staff?: { id: string; name: string }[];
  /** The Server Action to call with the raw form values. */
  submit: (values: CreateCustomerInput & UpdateCustomerInput) => Promise<ActionResult<unknown>>;
  onSaved: (result: unknown) => void;
  onCancel: () => void;
};

export function CustomerForm({
  mode,
  defaultValues,
  branches = [],
  masked = [],
  staff = [],
  submit,
  onSaved,
  onCancel,
}: CustomerFormProps) {
  const t = useTranslations();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [duplicate, setDuplicate] = useState<DuplicatePerson | null>(null);

  // The same schema the server uses gives instant feedback. Raw values are sent so
  // the server parses (and trusts) only its own transformation.
  const resolver = zodResolver(
    z.preprocess(fromNone, mode === "create" ? createCustomerSchema : updateCustomerSchema) as never,
    undefined,
    { raw: true },
  );
  const form = useForm<CustomerFormValues>({ resolver: resolver as never, defaultValues });

  const onSubmit = form.handleSubmit((values) => {
    const { status, branchId, phone, email, address, emergencyContactName, emergencyContactPhone, ...rest } = fromNone(
      values,
    ) as CustomerFormValues;
    const fields = {
      ...rest,
      ...(masked.includes("phone") ? {} : { phone }),
      ...(masked.includes("email") ? {} : { email }),
      ...(masked.includes("address") ? {} : { address, emergencyContactName, emergencyContactPhone }),
    };
    startTransition(async () => {
      const input = mode === "create" ? { ...fields, phone, branchId } : { ...fields, status };
      const result = await submit(input as CreateCustomerInput & UpdateCustomerInput);
      if (result.ok) return onSaved(result.data);
      setDuplicate(result.duplicate ?? null);
      applyFieldErrors(form.setError, result.fieldErrors);
      notify.error(errorMessage(result.code));
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <FieldGroup className="flex-1 overflow-y-auto px-4">
        {mode === "create" && branches.length > 1 && (
          <SelectField
            control={form.control}
            name="branchId"
            label={t("customers.fields.branch")}
            placeholder={t("common.chooseBranch")}
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        )}
        <TextField control={form.control} name="fullName" label={t("customers.fields.fullName")} autoComplete="off" />
        {!masked.includes("phone") && (
          <TextField
            control={form.control}
            name="phone"
            label={t("customers.fields.phone")}
            type="tel"
            inputMode="tel"
            placeholder={t("customers.phonePlaceholder")}
          />
        )}
        {!masked.includes("email") && (
          <TextField control={form.control} name="email" label={t("customers.fields.email")} type="email" />
        )}
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
        {!masked.includes("address") && (
          <>
            <TextField
              control={form.control}
              name="address"
              label={t("customers.fields.address")}
              autoComplete="off"
              multiline
            />
            <TextField
              control={form.control}
              name="emergencyContactName"
              label={t("customers.fields.emergencyContactName")}
              autoComplete="off"
            />
            <TextField
              control={form.control}
              name="emergencyContactPhone"
              label={t("customers.fields.emergencyContactPhone")}
              type="tel"
              inputMode="tel"
              placeholder={t("customers.phonePlaceholder")}
            />
          </>
        )}
        <OptionSelect
          control={form.control}
          name="customerGroupId"
          noteName="customerGroupNote"
          listKey="customerGroups"
          label={t("customers.fields.customerGroup")}
          noneLabel={t("customers.noGroup")}
        />
        <SelectField
          control={form.control}
          name="staffInChargeId"
          label={t("customers.fields.staffInCharge")}
          options={[
            { value: NO_OPTION, label: t("customers.noStaff") },
            ...staff.map((person) => ({ value: person.id, label: person.name })),
          ]}
        />
        <TextField control={form.control} name="notes" label={t("customers.fields.notes")} multiline />
        <DuplicateNotice duplicate={duplicate} />
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
