"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BanIcon, CheckCircleIcon, FilePlusIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { formatDateOnly } from "@/lib/format";
import { ContractForm, type ContractFormValues } from "./contract-form";
import {
  activateContractAction,
  cancelContractAction,
  createContractAction,
  updateContractAction,
} from "./actions";

const EMPTY: ContractFormValues = { packageName: "", contractValue: "", totalSessions: "", startDate: "", endDate: "" };

/** "Add contract" for one customer: a short form, so it opens in a Sheet (docs/23 §7). */
export function CreateContractButton({ customerId }: { customerId: string }) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // New key each time the sheet opens; retries and double-clicks inside it reuse it (T-015).
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const openSheet = () => {
    setIdempotencyKey(crypto.randomUUID());
    setOpen(true);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={openSheet}>
        <FilePlusIcon />
        {t("create")}
      </Button>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("create")}</SheetTitle>
          <SheetDescription>{t("createDescription")}</SheetDescription>
        </SheetHeader>
        <ContractForm
          defaultValues={EMPTY}
          submit={(values) => createContractAction(customerId, values, idempotencyKey)}
          onCancel={() => setOpen(false)}
          onSaved={(result) => {
            const { id, contractCode } = result as { id: string; contractCode: string };
            setOpen(false);
            notify.success(t("created", { code: contractCode }));
            router.push(`/contracts/${id}`);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

type EditableContract = {
  id: string;
  packageName: string;
  contractValue: number;
  totalSessions: number;
  startDate: Date;
  endDate: Date;
};

export function EditContractButton({ contract }: { contract: EditableContract }) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const defaultValues: ContractFormValues = {
    packageName: contract.packageName,
    contractValue: String(contract.contractValue),
    totalSessions: String(contract.totalSessions),
    startDate: formatDateOnly(contract.startDate),
    endDate: formatDateOnly(contract.endDate),
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("edit")}
      </Button>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("edit")}</SheetTitle>
          <SheetDescription>{t("editDescription")}</SheetDescription>
        </SheetHeader>
        <ContractForm
          defaultValues={defaultValues}
          submit={(values) => updateContractAction(contract.id, values)}
          onCancel={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            notify.success(t("updated"));
            router.refresh();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

type StatusActionProps = { contract: { id: string; contractCode: string } };

export function ActivateContractButton({ contract }: StatusActionProps) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  const run = useStatusAction(() => activateContractAction(contract.id), t("activated", { code: contract.contractCode }));
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CheckCircleIcon />
        {t("activate")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("activateTitle", { code: contract.contractCode })}
        description={t("activateBody")}
        confirmLabel={t("activate")}
        onConfirm={run}
      />
    </>
  );
}

type BookingToCancel = { id: string; scheduledStart: Date; scheduledEnd: Date; trainer: { fullName: string } };

/** D-010: the confirmation lists the BOOKED bookings that are cancelled with the contract. */
export function CancelContractButton({ contract, bookings }: StatusActionProps & { bookings: BookingToCancel[] }) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  const run = useStatusAction(() => cancelContractAction(contract.id), t("cancelled", { code: contract.contractCode }));
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BanIcon />
        {t("cancel")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("cancelTitle", { code: contract.contractCode })}
        description={t("cancelBody")}
        confirmLabel={t("cancel")}
        destructive
        onConfirm={run}
      >
        {bookings.length > 0 && (
          <div className="space-y-2 text-sm">
            <p>{t("cancelBookingsList", { count: bookings.length })}</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
              {bookings.map((booking) => (
                <li key={booking.id} className="flex justify-between gap-4 tabular-nums">
                  <span>
                    <DateTime value={booking.scheduledStart} format="dateTime" />–<DateTime value={booking.scheduledEnd} format="time" />
                  </span>
                  <span className="truncate text-muted-foreground">{booking.trainer.fullName}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

function useStatusAction(action: () => ReturnType<typeof activateContractAction>, successMessage: string) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  return async () => {
    const result = await action();
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return false;
    }
    notify.success(successMessage);
    router.refresh();
  };
}
