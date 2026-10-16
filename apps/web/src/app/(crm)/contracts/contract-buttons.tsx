"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BanIcon, CheckCircleIcon, FilePlusIcon, PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { activateContractAction, cancelContractAction } from "./actions";

/** "Add contract" for one customer: the form is long, so it is a page of its own (docs/23 §7). */
export function CreateContractButton({ customerId }: { customerId: string }) {
  const t = useTranslations("contracts");
  return (
    <Button asChild>
      <Link href={`/customers/${customerId}/contracts/new`}>
        <FilePlusIcon />
        {t("create")}
      </Link>
    </Button>
  );
}

export function EditContractButton({ contract }: { contract: { id: string } }) {
  const t = useTranslations("contracts");
  return (
    <Button asChild variant="outline">
      <Link href={`/contracts/${contract.id}/edit`}>
        <PencilIcon />
        {t("edit")}
      </Link>
    </Button>
  );
}

type StatusActionProps = { contract: { id: string; contractCode: string } };

export function ActivateContractButton({ contract }: StatusActionProps) {
  const t = useTranslations("contracts");
  const [open, setOpen] = useState(false);
  const run = useStatusAction(
    () => activateContractAction(contract.id),
    t("activated", { code: contract.contractCode }),
  );
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
                    <DateTime value={booking.scheduledStart} format="dateTime" />–
                    <DateTime value={booking.scheduledEnd} format="time" />
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
