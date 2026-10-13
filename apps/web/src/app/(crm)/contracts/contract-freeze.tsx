"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon, LockOpenIcon } from "lucide-react";
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
import { DateTime } from "@/components/date-time";
import { SelectField, TextField, applyFieldErrors } from "@/components/form-fields";
import { notify } from "@/components/notify";
import { OptionSelect } from "@/components/option-select";
import { deactivateSchema, EXTENSION_CHOICES, endDateAfterFreeze, reactivateSchema } from "@flow/shared/contracts";
import { useSubmit } from "../admin/users/user-dialogs";
import { ReasonDialog } from "./contract-decisions";
import { deactivateContractAction, reactivateContractAction } from "./actions";

type ContractRef = { id: string; contractCode: string };

/** Admin locks a running contract for review, with a reason (D-023). */
export function DeactivateContractButton({ contract }: { contract: ContractRef }) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <LockIcon />
        {t("deactivate")}
      </Button>
      {open && (
        <ReasonDialog
          title={t("deactivateTitle", { code: contract.contractCode })}
          body={t("deactivateBody")}
          reasonLabel={t("deactivateReason")}
          confirmLabel={t("deactivate")}
          listKey="freezeReasons"
          schema={deactivateSchema}
          run={(input) => deactivateContractAction(contract.id, input)}
          success={t("deactivated", { code: contract.contractCode })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type FreezeInfo = { frozenOn: Date; frozenDays: number; proposedEndDate: Date };
type ReactivateValues = { reasonId: string; reasonNote: string; extension: string; days: string };

/**
 * Reactivating shows the frozen days, the old end date, and the proposed one; admin adds them all, edits the number of
 * days, or adds none, and gives a reason (D-023, brief §5.5).
 */
export function ReactivateContractButton({
  contract,
}: {
  contract: ContractRef & { endDate: Date; freeze: FreezeInfo };
}) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <LockOpenIcon />
        {t("reactivate")}
      </Button>
      {open && <ReactivateDialog contract={contract} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReactivateDialog({
  contract,
  onClose,
}: {
  contract: ContractRef & { endDate: Date; freeze: FreezeInfo };
  onClose: () => void;
}) {
  const t = useTranslations("contracts");
  const common = useTranslations("common");
  const router = useRouter();
  const { pending, run } = useSubmit();
  const { frozenDays } = contract.freeze;
  const form = useForm<ReactivateValues>({
    resolver: zodResolver(reactivateSchema, undefined, { raw: true }) as never,
    defaultValues: { reasonId: "", reasonNote: "", extension: "ALL", days: String(frozenDays) },
  });
  const extension = useWatch({ control: form.control, name: "extension" });
  const customDays = useWatch({ control: form.control, name: "days" });
  const added = extension === "ALL" ? frozenDays : extension === "CUSTOM" ? Number(customDays) || 0 : 0;

  const onSubmit = form.handleSubmit((values) =>
    run(
      () =>
        reactivateContractAction(contract.id, {
          ...values,
          extension: values.extension as (typeof EXTENSION_CHOICES)[number],
        }),
      (fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
      () => {
        notify.success(t("reactivated", { code: contract.contractCode }));
        onClose();
        router.refresh();
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <DialogHeader>
            <DialogTitle>{t("reactivateTitle", { code: contract.contractCode })}</DialogTitle>
            <DialogDescription>
              {t("reactivateBody", { days: frozenDays })}{" "}
              <DateTime value={contract.freeze.frozenOn} format="dateOnly" />
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">{t("oldEndDate")}</dt>
            <dd className="text-right">
              <DateTime value={contract.endDate} format="dateOnly" />
            </dd>
            <dt className="text-muted-foreground">{t("newEndDate")}</dt>
            <dd className="text-right font-medium" data-testid="new-end-date">
              <DateTime value={endDateAfterFreeze(contract.endDate, added)} format="dateOnly" />
            </dd>
          </dl>
          <FieldGroup>
            <SelectField
              control={form.control}
              name="extension"
              label={t("extension")}
              options={EXTENSION_CHOICES.map((choice) => ({
                value: choice,
                label: t(`extensions.${choice}`, { days: frozenDays }),
              }))}
            />
            {extension === "CUSTOM" && (
              <TextField control={form.control} name="days" label={t("extensionDays")} inputMode="numeric" />
            )}
            <OptionSelect
              control={form.control}
              name="reasonId"
              noteName="reasonNote"
              listKey="unfreezeReasons"
              label={t("reactivateReason")}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("reactivate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
