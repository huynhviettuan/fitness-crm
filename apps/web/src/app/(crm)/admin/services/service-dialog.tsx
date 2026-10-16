"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { CheckboxListField, SelectField, SwitchField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { formatDateOnly } from "@/lib/format";
import { SERVICE_KINDS, serviceInputSchema, type Service } from "@gymcrm/shared/services";
import { useSubmit } from "../users/user-dialogs";
import { createServiceAction, updateServiceAction } from "./actions";

type ServiceFormValues = {
  name: string;
  kind: string;
  branchIds: string[];
  allowedFrom: string;
  allowedTo: string;
  commissionRate: string;
  isGroup: boolean;
  maxMembers: string;
  maxPerWeek: string;
  maxPerDay: string;
  activeFrom: string;
  activeTo: string;
  active: boolean;
  notes: string;
};

type Props = {
  service: Service | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
};

/** Adds a service or edits one (FR-SVC-001): Admin only. A service is made inactive, never deleted. */
export function ServiceDialog({ service, branches, onClose }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      name: service?.name ?? "",
      kind: service?.kind ?? "PT",
      branchIds: service?.branches.map((branch) => branch.id) ?? (branches.length === 1 ? [branches[0]!.id] : []),
      allowedFrom: service?.allowedFrom ?? "",
      allowedTo: service?.allowedTo ?? "",
      commissionRate: String(service?.commissionRate ?? 100),
      isGroup: service?.isGroup ?? false,
      maxMembers: service?.maxMembers?.toString() ?? "",
      maxPerWeek: service?.maxPerWeek?.toString() ?? "",
      maxPerDay: service?.maxPerDay?.toString() ?? "",
      activeFrom: service?.activeFrom ? formatDateOnly(service.activeFrom) : "",
      activeTo: service?.activeTo ? formatDateOnly(service.activeTo) : "",
      active: service?.active ?? true,
      notes: service?.notes ?? "",
    },
  });
  const isGroup = useWatch({ control: form.control, name: "isGroup" });

  const done = (message: string, id?: string) => {
    notify.success(message);
    onClose();
    if (id) router.push(`/admin/services/${id}`);
    else router.refresh();
  };
  const onSubmit = form.handleSubmit((values) => {
    const showErrors = (fieldErrors?: Record<string, string[]>) => applyFieldErrors(form.setError, fieldErrors);
    if (service)
      run(
        () => updateServiceAction(service.id, values as never),
        showErrors,
        () => done(t("services.saved")),
      );
    else
      run(
        () => createServiceAction(values as never),
        showErrors,
        ({ id, name }) => done(t("services.created", { name }), id),
      );
  });
  const f = (key: string) => t(`services.fields.${key}` as never);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{service ? t("services.edit") : t("services.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="max-h-[60vh] overflow-y-auto px-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="name" label={f("name")} autoComplete="off" />
              <SelectField
                control={form.control}
                name="kind"
                label={f("kind")}
                options={SERVICE_KINDS.map((kind) => ({ value: kind, label: t(`services.kinds.${kind}`) }))}
              />
            </div>
            <CheckboxListField
              control={form.control}
              name="branchIds"
              label={f("branches")}
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="allowedFrom"
                label={f("allowedFrom")}
                placeholder="06:00"
                inputMode="numeric"
              />
              <TextField
                control={form.control}
                name="allowedTo"
                label={f("allowedTo")}
                placeholder="21:00"
                inputMode="numeric"
              />
              <TextField control={form.control} name="commissionRate" label={f("commissionRate")} inputMode="decimal" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField control={form.control} name="maxPerWeek" label={f("maxPerWeek")} inputMode="numeric" />
              <TextField control={form.control} name="maxPerDay" label={f("maxPerDay")} inputMode="numeric" />
              <SwitchField control={form.control} name="isGroup" label={f("isGroup")} />
            </div>
            {isGroup && (
              <TextField control={form.control} name="maxMembers" label={f("maxMembers")} inputMode="numeric" />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="activeFrom" label={f("activeFrom")} placeholder="dd/mm/yyyy" />
              <TextField control={form.control} name="activeTo" label={f("activeTo")} placeholder="dd/mm/yyyy" />
            </div>
            <TextField control={form.control} name="notes" label={f("notes")} multiline />
            {service && <SwitchField control={form.control} name="active" label={f("active")} />}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
