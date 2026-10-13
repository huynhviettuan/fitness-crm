"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { BanIcon, CalendarClockIcon, CheckCheckIcon, LogInIcon, UserXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { Badge } from "@/components/ui/badge";
import { SessionStatusBadge } from "@/components/status-badge";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { formatDate, formatTime } from "@/lib/format";
import { canCancelBooking, canCheckIn, canComplete, canMarkNoShow, canReschedule } from "@flow/shared/bookings";
import { cancelBookingAction, checkInAction, completeSessionAction, markNoShowAction } from "./actions";
import { BookingFormDialog } from "./booking-form";
import type { BookingPermissions, BookingRow, TrainerOption } from "./booking-types";

type BookingSheetProps = {
  /** The booking to show; null closes the sheet. */
  booking: BookingRow | null;
  onClose: () => void;
  permissions: BookingPermissions;
  trainers: TrainerOption[];
};

/** Booking details and the actions its status allows (A-006, docs/23 §9). */
export function BookingSheet({ booking, onClose, permissions, trainers }: BookingSheetProps) {
  const t = useTranslations("bookings");
  const timeZone = useTimeZone() ?? "UTC";

  return (
    <Sheet open={booking !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-md">
        {booking && (
          <>
            <SheetHeader>
              <SheetTitle>{booking.customer.fullName}</SheetTitle>
              <SheetDescription>
                {formatDate(booking.scheduledStart, timeZone)} ·{" "}
                {t("timeRange", {
                  start: formatTime(booking.scheduledStart, timeZone),
                  end: formatTime(booking.scheduledEnd, timeZone),
                })}
              </SheetDescription>
            </SheetHeader>
            <BookingDetails booking={booking} />
            <SheetFooter className="border-t">
              <BookingActions booking={booking} permissions={permissions} trainers={trainers} />
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function BookingDetails({ booking }: { booking: BookingRow }) {
  const t = useTranslations("bookings");
  const f = (key: Parameters<typeof t>[0]) => t(key);
  const by = (time: Date, name: string) => (
    <>
      <DateTime value={time} format="time" />, {name}
    </>
  );

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: f("fields.status"),
      value: (
        <span className="flex flex-wrap items-center gap-1">
          <SessionStatusBadge rule={booking.statusRule} />
          {/* Check-in is a fact on a Booked session, not a status of its own (D-025). */}
          {booking.checkedIn && booking.status === "BOOKED" && <Badge variant="warning">{t("checkedInBadge")}</Badge>}
        </span>
      ),
    },
    {
      label: f("fields.customer"),
      value: (
        <Link href={`/customers/${booking.customer.id}`} className="hover:underline">
          {booking.customer.customerCode} · {booking.customer.fullName}
        </Link>
      ),
    },
    {
      label: f("fields.contract"),
      value: (
        <Link href={`/contracts/${booking.contract.id}`} className="hover:underline">
          {booking.contract.contractCode} · {booking.contract.packageName}
        </Link>
      ),
    },
    {
      label: f("fields.remainingSessions"),
      value: <span className="tabular-nums">{booking.contract.remainingSessions}</span>,
    },
    { label: f("fields.trainer"), value: `${booking.trainer.fullName} · ${booking.trainer.employeeCode}` },
    ...(booking.session
      ? [{ label: f("fields.checkedIn"), value: by(booking.session.checkedInAt, booking.session.checkedInBy) }]
      : []),
    ...(booking.session?.completedAt && booking.session.completedBy
      ? [{ label: f("fields.completed"), value: by(booking.session.completedAt, booking.session.completedBy) }]
      : []),
  ];

  return (
    <dl className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-right text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Confirm = "complete" | "cancel" | "noShow" | null;

function BookingActions({
  booking,
  permissions,
  trainers,
}: Omit<BookingSheetProps, "booking" | "onClose"> & { booking: BookingRow }) {
  const t = useTranslations("bookings");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [checkingIn, startCheckIn] = useTransition();

  /** Runs an action; on failure shows the error and keeps the dialog open. */
  const run = async <T,>(action: () => Promise<ActionResult<T>>, success: (data: T) => string) => {
    const result = await action();
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return false;
    }
    notify.success(success(result.data));
    router.refresh();
  };

  const facts = { status: booking.status, checkedIn: booking.checkedIn };
  const remaining = booking.contract.remainingSessions;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {permissions.manage && canReschedule(facts) && (
        <Button variant="outline" onClick={() => setRescheduling(true)}>
          <CalendarClockIcon />
          {t("reschedule")}
        </Button>
      )}
      {permissions.manage && canMarkNoShow(facts) && (
        <Button variant="outline" onClick={() => setConfirm("noShow")}>
          <UserXIcon />
          {t("noShow")}
        </Button>
      )}
      {permissions.manage && canCancelBooking(facts) && (
        <Button variant="outline" onClick={() => setConfirm("cancel")}>
          <BanIcon />
          {t("cancel")}
        </Button>
      )}
      {permissions.checkIn && canCheckIn(facts) && (
        <Button
          disabled={checkingIn}
          onClick={() =>
            startCheckIn(async () => {
              await run(
                () => checkInAction(booking.id),
                () => t("checkedIn", { customer: booking.customer.fullName }),
              );
            })
          }
        >
          <LogInIcon />
          {t("checkIn")}
        </Button>
      )}
      {permissions.complete && canComplete(facts) && (
        <Button onClick={() => setConfirm("complete")}>
          <CheckCheckIcon />
          {t("complete")}
        </Button>
      )}

      <ConfirmDialog
        open={confirm === "complete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("completeTitle")}
        description={t("completeBody", { code: booking.contract.contractCode, from: remaining, to: remaining - 1 })}
        confirmLabel={t("complete")}
        onConfirm={() =>
          run(
            () => completeSessionAction(booking.id),
            (data) => t("completed", { remaining: data.remainingSessions }),
          )
        }
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("cancelTitle")}
        description={booking.checkedIn ? t("cancelCheckedInBody") : t("cancelBody")}
        confirmLabel={t("cancel")}
        dismissLabel={t("keep")}
        destructive
        onConfirm={() =>
          run(
            () => cancelBookingAction(booking.id),
            () => t("cancelled"),
          )
        }
      />
      <ConfirmDialog
        open={confirm === "noShow"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("noShowTitle")}
        description={t("noShowBody")}
        confirmLabel={t("noShow")}
        dismissLabel={t("keep")}
        onConfirm={() =>
          run(
            () => markNoShowAction(booking.id),
            () => t("markedNoShow"),
          )
        }
      />
      <BookingFormDialog
        open={rescheduling}
        onOpenChange={setRescheduling}
        mode="reschedule"
        booking={booking}
        trainers={trainers}
      />
    </div>
  );
}
