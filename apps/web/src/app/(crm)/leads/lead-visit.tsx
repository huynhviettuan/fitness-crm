"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, type Control, type FieldValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DoorOpenIcon, UserXIcon } from "lucide-react";
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CheckboxField, SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { useCountryOptions } from "@/components/use-countries";
import { useErrorMessage } from "@/components/use-error-message";
import { formatDateOnly } from "@/lib/format";
import { ID_DOCUMENT_TYPES, showInputSchema, type Lead } from "@gymcrm/shared/leads";
import { useSubmit } from "../admin/users/user-dialogs";
import { noShowLeadAction, showLeadAction } from "./actions";

export type ShowValues = {
  idDocumentType: string;
  idDocumentNumber: string;
  birthDate: string;
  countryCode: string;
  email: string;
  phone: string;
  healthNote: string;
  consent: boolean;
};

/** What the lead already has fills the form (brief §3 stage 3). */
export function showDefaults(lead: Lead): ShowValues {
  return {
    idDocumentType: "CCCD",
    idDocumentNumber: "",
    birthDate: lead.birthDate ? formatDateOnly(lead.birthDate) : "",
    countryCode: lead.countryCode ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    healthNote: "",
    consent: false,
  };
}

/**
 * The Show details (D-019, D-036, D-042): ID document, birth date, nationality, email,
 * phone, basic health, and the customer's consent. `prefix` places them in a larger form,
 * e.g. "show." in the checklist's step dialog.
 */
export function ShowFields<T extends FieldValues>({ control, prefix = "" }: { control: Control<T>; prefix?: string }) {
  const t = useTranslations("visit");
  const countries = useCountryOptions();
  const name = (field: keyof ShowValues) => `${prefix}${field}` as Path<T>;
  return (
    <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <SelectField
          control={control}
          name={name("idDocumentType")}
          label={t("fields.idDocumentType")}
          options={ID_DOCUMENT_TYPES.map((value) => ({ value, label: t(`idDocumentTypes.${value}`) }))}
        />
        <TextField
          control={control}
          name={name("idDocumentNumber")}
          label={t("fields.idDocumentNumber")}
          autoComplete="off"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name={name("birthDate")}
          label={t("fields.birthDate")}
          placeholder={t("datePlaceholder")}
          autoComplete="off"
        />
        <SelectField control={control} name={name("countryCode")} label={t("fields.nationality")} options={countries} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={control} name={name("email")} label={t("fields.email")} type="email" autoComplete="off" />
        <TextField control={control} name={name("phone")} label={t("fields.phone")} type="tel" inputMode="tel" />
      </div>
      <TextField control={control} name={name("healthNote")} label={t("fields.healthNote")} multiline />
      <CheckboxField
        control={control}
        name={name("consent")}
        label={t("fields.consent")}
        description={t("consentHint")}
      />
    </FieldGroup>
  );
}

/** Show (D-019): the lead came in and becomes a customer; the customer's page opens. */
export function ShowButton({ lead }: { lead: Lead }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useSubmit();
  const form = useForm<ShowValues>({
    resolver: zodResolver(showInputSchema, undefined, { raw: true }) as never,
    defaultValues: showDefaults(lead),
  });
  const onSubmit = form.handleSubmit((values) =>
    run(
      () => showLeadAction(lead.id, values as never),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      ({ customerId }) => {
        notify.success(t("visit.converted", { name: lead.fullName }));
        router.push(`/customers/${customerId}`);
      },
    ),
  );

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <DoorOpenIcon />
        {t("visit.show")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto">
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            <DialogHeader>
              <DialogTitle>{t("visit.showTitle", { name: lead.fullName })}</DialogTitle>
              <DialogDescription>{t("visit.showDescription")}</DialogDescription>
            </DialogHeader>
            <ShowFields control={form.control} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("visit.convert")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** No show: a booked lead did not come and goes to re-care (BR-204). */
export function NoShowButton({ lead }: { lead: Lead }) {
  const t = useTranslations("visit");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserXIcon />
        {t("noShow")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("noShowTitle", { name: lead.fullName })}
        description={t("noShowDescription")}
        confirmLabel={t("noShowConfirm")}
        onConfirm={async () => {
          const result = await noShowLeadAction(lead.id);
          if (!result.ok) {
            notify.error(errorMessage(result.code));
            return false;
          }
          notify.success(t("noShowRecorded"));
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
