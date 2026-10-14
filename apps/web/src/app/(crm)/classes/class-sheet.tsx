"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { CheckIcon, UserMinusIcon, XIcon } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SelectField } from "@/components/form-fields";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { ActionResult } from "@/lib/actions/result";
import { formatDate, formatTime } from "@/lib/format";
import type { ClassAttendee, ClassSession } from "@flow/shared/classes";
import { CustomerPicker } from "../bookings/booking-form";
import { enrollAction, getClassSessionAction, markAttendeeAction, removeAttendeeAction } from "./actions";
import type { ClassPermissions } from "./class-types";

type Props = { sessionId: string | null; onClose: () => void; permissions: ClassPermissions };

/** One class session: its seats, enrolling, and marking attendance (brief §6.4). */
export function ClassSheet({ sessionId, onClose, permissions }: Props) {
  const t = useTranslations("classes");
  const timeZone = useTimeZone() ?? "UTC";
  const errorMessage = useErrorMessage();
  const [loaded, setLoaded] = useState<ClassSession | null>(null);
  const session = loaded?.id === sessionId ? loaded : null;

  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    getClassSessionAction(sessionId).then((result) => {
      if (!current) return;
      if (result.ok) setLoaded(result.data);
      else notify.error(errorMessage(result.code));
    });
    return () => {
      current = false;
    };
  }, [sessionId, errorMessage]);

  return (
    <Sheet open={sessionId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{session?.name ?? t("loading")}</SheetTitle>
          <SheetDescription>
            {session
              ? `${formatDate(session.startsAt, timeZone)} · ${t("timeRange", {
                  start: formatTime(session.startsAt, timeZone),
                  end: formatTime(session.endsAt, timeZone),
                })} · ${session.coach.fullName}`
              : t("loading")}
          </SheetDescription>
        </SheetHeader>
        {session && <SessionBody session={session} onChange={setLoaded} permissions={permissions} />}
      </SheetContent>
    </Sheet>
  );
}

function SessionBody({
  session,
  onChange,
  permissions,
}: {
  session: ClassSession;
  onChange: (session: ClassSession) => void;
  permissions: ClassPermissions;
}) {
  const t = useTranslations("classes");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  // The time the sheet was opened; the API refuses a mark before the class starts in any case.
  const [openedAt] = useState(() => Date.now());
  const started = session.startsAt.getTime() <= openedAt;
  const cancelled = session.status === "CANCELLED";

  /** Runs an action; the answer is the class session as it is now. */
  const run = (action: () => Promise<ActionResult<ClassSession>>, success: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        notify.error(errorMessage(result.code));
        return;
      }
      onChange(result.data);
      notify.success(success);
      router.refresh();
    });

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={cancelled ? "muted" : "info"}>{t(`status.${session.status}`)}</Badge>
        <span className="tabular-nums" data-testid="class-seats">
          {t("seats", { taken: session.seatsTaken, capacity: session.capacity })}
        </span>
        {session.taught && <Badge variant="success">{t("taught")}</Badge>}
      </div>

      <ul className="space-y-2" aria-label={t("attendees")}>
        {session.attendees?.length === 0 && <li className="text-sm text-muted-foreground">{t("noAttendees")}</li>}
        {session.attendees?.map((attendee) => (
          <AttendeeRow
            key={attendee.id}
            attendee={attendee}
            canMark={permissions.attend && started && !cancelled}
            canRemove={permissions.enroll}
            pending={pending}
            onMark={(status) =>
              run(
                () => markAttendeeAction(session.id, attendee.id, { status }),
                t(status === "PRESENT" ? "markedPresent" : "markedAbsent"),
              )
            }
            onRemove={() => run(() => removeAttendeeAction(session.id, attendee.id), t("removed"))}
          />
        ))}
      </ul>

      {permissions.enroll && !cancelled && (
        <EnrollForm
          sessionId={session.id}
          full={session.seatsTaken >= session.capacity}
          onEnrolled={(next) => {
            onChange(next);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AttendeeRow({
  attendee,
  canMark,
  canRemove,
  pending,
  onMark,
  onRemove,
}: {
  attendee: ClassAttendee;
  canMark: boolean;
  canRemove: boolean;
  pending: boolean;
  onMark: (status: "PRESENT" | "ABSENT") => void;
  onRemove: () => void;
}) {
  const t = useTranslations("classes");
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="min-w-0">
        <Link href={`/customers/${attendee.customer.id}`} className="font-medium hover:underline">
          {attendee.customer.fullName}
        </Link>
        <p className="text-xs text-muted-foreground">
          {attendee.contract.contractCode} · {t("remaining", { count: attendee.contract.remainingSessions })}
          {attendee.markedAt && (
            <>
              {" · "}
              <DateTime value={attendee.markedAt} format="time" />
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={attendee.status === "PRESENT" ? "success" : attendee.status === "ABSENT" ? "muted" : "warning"}>
          {t(`attendance.${attendee.status}`)}
        </Badge>
        {attendee.status === "ENROLLED" && canMark && (
          <>
            <Button size="sm" disabled={pending} onClick={() => onMark("PRESENT")}>
              <CheckIcon />
              {t("present")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => onMark("ABSENT")}>
              <XIcon />
              {t("absent")}
            </Button>
          </>
        )}
        {attendee.status === "ENROLLED" && canRemove && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onRemove} aria-label={t("remove")}>
            <UserMinusIcon />
          </Button>
        )}
      </div>
    </li>
  );
}

type ClassContract = { id: string; contractCode: string; packageName: string; remainingSessions: number };

/** The customer's active group-class contracts with sessions left (BR-411), or null while loading. */
function useClassContracts(customerId: string): ClassContract[] | null {
  const [state, setState] = useState<{ customerId: string; contracts: ClassContract[] } | null>(null);
  useEffect(() => {
    if (!customerId) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/v1/customers/${customerId}/contracts?pageSize=100`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const { items } = (await response.json()) as {
          items: (ClassContract & { status: string; service: { kind: string } | null })[];
        };
        setState({
          customerId,
          contracts: items.filter(
            (c) => c.status === "ACTIVE" && c.service?.kind === "CLASS" && c.remainingSessions > 0,
          ),
        });
      } catch {
        // Aborted by a newer customer; nothing to do.
      }
    })();
    return () => controller.abort();
  }, [customerId]);
  return state?.customerId === customerId ? state.contracts : null;
}

function EnrollForm({
  sessionId,
  full,
  onEnrolled,
}: {
  sessionId: string;
  full: boolean;
  onEnrolled: (session: ClassSession) => void;
}) {
  const t = useTranslations("classes");
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const form = useForm<{ customerId: string; contractId: string }>({
    defaultValues: { customerId: "", contractId: "" },
  });
  const customerId = useWatch({ control: form.control, name: "customerId" });
  const contractId = useWatch({ control: form.control, name: "contractId" });
  const contracts = useClassContracts(customerId);

  const submit = () =>
    startTransition(async () => {
      const result = await enrollAction(sessionId, { customerId, contractId });
      if (!result.ok) {
        notify.error(errorMessage(result.code));
        return;
      }
      notify.success(t("enrolled"));
      form.reset({ customerId: "", contractId: "" });
      onEnrolled(result.data);
    });

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      aria-label={t("enrollTitle")}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-sm font-medium">{t("enrollTitle")}</h3>
      {full && <p className="text-sm text-destructive">{t("full")}</p>}
      <CustomerPicker control={form.control} onPicked={() => form.setValue("contractId", "")} />
      {customerId && contracts?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noClassContracts")}</p>
      ) : (
        customerId && (
          <SelectField
            control={form.control}
            name="contractId"
            label={t("contract")}
            placeholder={t("choose")}
            options={(contracts ?? []).map((c) => ({
              value: c.id,
              label: t("contractOption", {
                code: c.contractCode,
                package: c.packageName,
                remaining: c.remainingSessions,
              }),
            }))}
          />
        )
      )}
      <Button type="submit" disabled={pending || !customerId || !contractId}>
        {t("enroll")}
      </Button>
    </form>
  );
}
