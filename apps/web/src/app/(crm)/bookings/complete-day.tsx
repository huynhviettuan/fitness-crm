"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTimeZone, useTranslations } from "next-intl";
import { CheckCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import { formatTime } from "@/lib/format";
import type { ErrorCode } from "@flow/shared/errors";
import { parseDateOnly } from "@flow/shared/validation";
import { completeDayAction } from "./actions";

type DaySession = {
  id: string;
  scheduledStart: string;
  customer: { fullName: string };
  trainer: { fullName: string };
};

/** Bulk "Đã tập" for a day (M5.3, D-026): the admin reviews the day's Booked sessions and confirms the ticked ones. */
export function CompleteDayButton({ today }: { today: string }) {
  const t = useTranslations("bookings");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CheckCheckIcon />
        {t("completeDay.button")}
      </Button>
      {/* Mounted only while open, so each use starts from today with nothing ticked. */}
      {open && <CompleteDayDialog today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function CompleteDayDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const t = useTranslations("bookings");
  const timeZone = useTimeZone() ?? "UTC";
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [day, setDay] = useState(today);
  const [sessions, setSessions] = useState<DaySession[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  const load = async () => {
    const date = parseDateOnly(day);
    if (!date) return;
    setBusy(true);
    setFailures([]);
    try {
      const params = new URLSearchParams({ from: day, to: day, status: "BOOKED", order: "asc", pageSize: "100" });
      const response = await fetch(`/api/v1/bookings?${params}`);
      const items: DaySession[] = response.ok ? (await response.json()).items : [];
      setSessions(items);
      setTicked(new Set(items.map((item) => item.id)));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    const result = await completeDayAction([...ticked]);
    setBusy(false);
    if (!result.ok) {
      notify.error(errorMessage(result.code));
      return;
    }
    const failed = result.data.items.filter((item) => !item.ok);
    if (result.data.completed > 0) notify.success(t("completeDay.done", { count: result.data.completed }));
    router.refresh();
    if (failed.length === 0) {
      onClose();
      return;
    }
    // Keep the refused ones in the list with the reason, so the admin can deal with them.
    setFailures(
      failed.map((item) => `${nameOf(item.bookingId)}: ${errorMessage((item.code ?? "INTERNAL_ERROR") as ErrorCode)}`),
    );
    setSessions(
      (current) => current?.filter((session) => failed.some((item) => item.bookingId === session.id)) ?? null,
    );
    setTicked(new Set());
  };
  const nameOf = (id: string) => sessions?.find((session) => session.id === id)?.customer.fullName ?? id;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("completeDay.title")}</DialogTitle>
          <DialogDescription>{t("completeDay.body")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={day}
            onChange={(event) => setDay(event.target.value)}
            aria-label={t("completeDay.date")}
            placeholder={t("datePlaceholder")}
            inputMode="numeric"
            className="w-36"
          />
          <Button type="button" variant="outline" onClick={load} disabled={busy || !parseDateOnly(day)}>
            {t("completeDay.load")}
          </Button>
        </div>
        {sessions !== null &&
          (sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("completeDay.none")}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {sessions.map((session) => (
                <li key={session.id}>
                  <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <Checkbox
                      checked={ticked.has(session.id)}
                      onCheckedChange={(checked) =>
                        setTicked((current) => {
                          const next = new Set(current);
                          if (checked) next.add(session.id);
                          else next.delete(session.id);
                          return next;
                        })
                      }
                    />
                    {t("completeDay.item", {
                      time: formatTime(new Date(session.scheduledStart), timeZone),
                      customer: session.customer.fullName,
                      trainer: session.trainer.fullName,
                    })}
                  </label>
                </li>
              ))}
            </ul>
          ))}
        {failures.length > 0 && (
          <div role="alert" className="text-sm text-destructive">
            <p>{t("completeDay.someFailed", { failed: failures.length })}</p>
            <ul className="list-disc pl-5">
              {failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button type="button" onClick={submit} disabled={busy || ticked.size === 0}>
            {t("completeDay.submit", { count: ticked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
