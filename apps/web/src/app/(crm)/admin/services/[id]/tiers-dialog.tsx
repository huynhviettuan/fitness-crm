"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TextField, applyFieldErrors, useValidationMessage } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { tiersInputSchema, type PriceTier } from "@flow/shared/services";
import { useSubmit } from "../../users/user-dialogs";
import { saveTiersAction } from "../actions";

type Row = {
  minSessions: string;
  maxSessions: string;
  unitPrice: string;
  validityMonths: string;
  validityDays: string;
};
type TiersFormValues = { effectiveFrom: string; tiers: Row[] };

const EMPTY_ROW: Row = { minSessions: "", maxSessions: "", unitPrice: "", validityMonths: "", validityDays: "0" };

const COLUMNS = ["minSessions", "maxSessions", "unitPrice", "validityMonths", "validityDays"] as const;

/** The tiers of a service as a new version from a day on (BR-301): the whole set is entered again, Admin only. */
export function TiersDialog({
  serviceId,
  current,
  onClose,
}: {
  serviceId: string;
  /** The tiers of the version in force, to start from. */
  current: PriceTier[];
  onClose: () => void;
}) {
  const t = useTranslations("services.tiers");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const validationMessage = useValidationMessage();
  const form = useForm<TiersFormValues>({
    resolver: zodResolver(tiersInputSchema, undefined, { raw: true }) as never,
    defaultValues: {
      effectiveFrom: "",
      tiers:
        current.length > 0
          ? current.map((tier) => ({
              minSessions: String(tier.minSessions),
              maxSessions: tier.maxSessions === null ? "" : String(tier.maxSessions),
              unitPrice: String(tier.unitPrice),
              validityMonths: String(tier.validityMonths),
              validityDays: String(tier.validityDays),
            }))
          : [EMPTY_ROW],
    },
  });
  const rows = useFieldArray({ control: form.control, name: "tiers" });

  const onSubmit = form.handleSubmit((values) =>
    run(
      () => saveTiersAction(serviceId, values as never),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("saved"));
        onClose();
        router.refresh();
      },
    ),
  );
  const errors = form.formState.errors.tiers;
  const listError = errors?.root?.message ?? errors?.message;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("newVersionTitle")}</DialogTitle>
            <DialogDescription>{t("newVersionHint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="max-h-[60vh] overflow-y-auto px-1">
            <TextField
              control={form.control}
              name="effectiveFrom"
              label={t("effectiveFrom")}
              placeholder="dd/mm/yyyy"
              autoComplete="off"
            />
            <div className="space-y-2" role="group" aria-label={t("title")}>
              <div className="hidden grid-cols-[repeat(5,minmax(0,1fr))_2.5rem] gap-2 text-sm text-muted-foreground sm:grid">
                {COLUMNS.map((column) => (
                  <span key={column}>{t(`columns.${column}`)}</span>
                ))}
                <span />
              </div>
              {rows.fields.map((row, index) => (
                <div key={row.id} className="space-y-1">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(5,minmax(0,1fr))_2.5rem]">
                    {COLUMNS.map((column) => (
                      <Input
                        key={column}
                        {...form.register(`tiers.${index}.${column}`)}
                        aria-label={`${t(`columns.${column}`)} ${index + 1}`}
                        aria-invalid={errors?.[index]?.[column] ? true : undefined}
                        inputMode="numeric"
                        autoComplete="off"
                      />
                    ))}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={rows.fields.length === 1}
                      onClick={() => rows.remove(index)}
                      aria-label={t("removeRow", { index: index + 1 })}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  {COLUMNS.map((column) => {
                    const message = errors?.[index]?.[column]?.message;
                    return message ? <FieldError key={column}>{validationMessage(message)}</FieldError> : null;
                  })}
                </div>
              ))}
              {listError && <FieldError>{validationMessage(listError)}</FieldError>}
              <Button type="button" variant="outline" size="sm" onClick={() => rows.append({ ...EMPTY_ROW })}>
                <PlusIcon />
                {t("addRow")}
              </Button>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : t("saveVersion")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
