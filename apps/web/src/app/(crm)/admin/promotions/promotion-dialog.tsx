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
import { DISCOUNT_TYPES, PROMOTION_KINDS, promotionInputSchema, type Promotion } from "@gymcrm/shared/promotions";
import { useSubmit } from "../users/user-dialogs";
import { createPromotionAction, updatePromotionAction } from "./actions";

type PromotionFormValues = {
  kind: string;
  name: string;
  code: string;
  discountType: string;
  value: string;
  validFrom: string;
  validTo: string;
  serviceIds: string[];
  active: boolean;
};

/** Adds a promotion or a voucher, or edits one; its kind and code stay as made. Never deleted, only switched off. */
export function PromotionDialog({
  promotion,
  services,
  onClose,
}: {
  promotion: Promotion | null;
  services: { id: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { pending, run } = useSubmit();
  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      kind: promotion?.kind ?? "PROMOTION",
      name: promotion?.name ?? "",
      code: promotion?.code ?? "",
      discountType: promotion?.discountType ?? "PERCENT",
      value: promotion ? String(promotion.value) : "",
      validFrom: promotion?.validFrom ? formatDateOnly(promotion.validFrom) : "",
      validTo: promotion?.validTo ? formatDateOnly(promotion.validTo) : "",
      serviceIds: promotion?.services.map((service) => service.id) ?? [],
      active: promotion?.active ?? true,
    },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const f = (key: string) => t(`promotions.fields.${key}` as never);

  const onSubmit = form.handleSubmit((values) => {
    const showErrors = (fieldErrors?: Record<string, string[]>) => applyFieldErrors(form.setError, fieldErrors);
    const done = (key: "created" | "saved") => (data: { name: string }) => {
      notify.success(t(`promotions.${key}`, { name: data.name }));
      onClose();
      router.refresh();
    };
    if (promotion) run(() => updatePromotionAction(promotion.id, values as never), showErrors, done("saved"));
    else run(() => createPromotionAction(values as never), showErrors, done("created"));
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{promotion ? t("promotions.edit") : t("promotions.create")}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="max-h-[60vh] overflow-y-auto px-1">
            <div className="grid gap-4 sm:grid-cols-2">
              {promotion ? (
                <div className="space-y-1 text-sm">
                  <div className="text-muted-foreground">{f("kind")}</div>
                  <div>{t(`promotions.kinds.${promotion.kind}`)}</div>
                </div>
              ) : (
                <SelectField
                  control={form.control}
                  name="kind"
                  label={f("kind")}
                  options={PROMOTION_KINDS.map((value) => ({ value, label: t(`promotions.kinds.${value}`) }))}
                />
              )}
              <TextField control={form.control} name="name" label={f("name")} autoComplete="off" />
            </div>
            {kind === "VOUCHER" &&
              (promotion ? (
                <div className="space-y-1 text-sm">
                  <div className="text-muted-foreground">{f("code")}</div>
                  <div className="font-mono">{promotion.code}</div>
                </div>
              ) : (
                <TextField control={form.control} name="code" label={f("code")} autoComplete="off" />
              ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="discountType"
                label={f("discountType")}
                options={DISCOUNT_TYPES.map((value) => ({ value, label: t(`promotions.types.${value}`) }))}
              />
              <TextField control={form.control} name="value" label={f("value")} inputMode="decimal" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="validFrom" label={f("validFrom")} placeholder="dd/mm/yyyy" />
              <TextField control={form.control} name="validTo" label={f("validTo")} placeholder="dd/mm/yyyy" />
            </div>
            <CheckboxListField
              control={form.control}
              name="serviceIds"
              label={f("services")}
              description={t("promotions.allServices")}
              options={services.map((service) => ({ value: service.id, label: service.name }))}
            />
            {promotion && <SwitchField control={form.control} name="active" label={f("active")} />}
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
