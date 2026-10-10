"use client";

import { useState } from "react";
import { useTimeZone, useTranslations } from "next-intl";
import { TZDate } from "@date-fns/tz";
import { cn } from "cn";
import { statusSurfaceClass } from "@/components/status-badge";
import { formatTime } from "@/lib/format";
import { BookingFormDialog, type BookingPreset } from "../bookings/booking-form";
import { BookingSheet } from "../bookings/booking-sheet";
import type { BookingPermissions, BookingRow, TrainerOption } from "../bookings/booking-types";

const SLOT_MINUTES = 30;
// Height of one 30-minute row in pixels (h-12).
const SLOT_HEIGHT = 48;
const PX_PER_MINUTE = SLOT_HEIGHT / SLOT_MINUTES;
const DEFAULT_LENGTH_MINUTES = 60;

type TrainerScheduleGridProps = {
  /** The day shown, dd/MM/yyyy. */
  date: string;
  /** One column per trainer. */
  columns: TrainerOption[];
  /** Active bookings of the day (A-005); cancelled and no-show ones free the slot. */
  bookings: BookingRow[];
  /** The configured calendar hours, as minutes after midnight (D-030). */
  dayStart: number;
  dayEnd: number;
  permissions: BookingPermissions;
  /** Trainers a booking can be given to, for the create and reschedule forms. */
  trainers: TrainerOption[];
};

/**
 * The PT calendar (docs/23 §9): one day, trainers as columns, 30-minute rows. Clicking
 * an empty slot opens the create dialog for that trainer and time; clicking a booking
 * opens its sheet. Hours outside the configured range appear when a booking needs them.
 */
export function TrainerScheduleGrid({ date, columns, bookings, dayStart, dayEnd, permissions, trainers }: TrainerScheduleGridProps) {
  const t = useTranslations();
  const timeZone = useTimeZone() ?? "UTC";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preset, setPreset] = useState<BookingPreset | null>(null);
  const selected = bookings.find((b) => b.id === selectedId) ?? null;

  const minutesOf = (instant: Date) => {
    const local = new TZDate(instant, timeZone);
    return local.getHours() * 60 + local.getMinutes();
  };
  let first = dayStart;
  let last = dayEnd;
  for (const booking of bookings) {
    first = Math.min(first, Math.floor(minutesOf(booking.scheduledStart) / SLOT_MINUTES) * SLOT_MINUTES);
    last = Math.max(last, Math.ceil(minutesOf(booking.scheduledEnd) / SLOT_MINUTES) * SLOT_MINUTES);
  }
  const slots = Array.from({ length: (last - first) / SLOT_MINUTES }, (_, i) => first + i * SLOT_MINUTES);
  const bookable = (trainerId: string) => permissions.manage && trainers.some((tr) => tr.id === trainerId);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <div
          className="grid min-w-fit"
          // Layout only: one narrow time column, then one column per trainer.
          style={{ gridTemplateColumns: `4rem repeat(${columns.length}, minmax(10rem, 1fr))` }}
        >
          <div className="sticky top-0 border-b bg-background" />
          {columns.map((trainer) => (
            <div key={trainer.id} className="sticky top-0 truncate border-b border-l bg-background px-3 py-2 text-sm font-medium">
              {trainer.fullName}
            </div>
          ))}

          <div>
            {slots.map((minute) => (
              <div key={minute} className="h-12 border-b pt-1 pr-2 text-right text-xs text-muted-foreground tabular-nums">
                {clock(minute)}
              </div>
            ))}
          </div>
          {columns.map((trainer) => (
            <div key={trainer.id} role="group" aria-label={trainer.fullName} className="relative border-l">
              {slots.map((minute) =>
                bookable(trainer.id) ? (
                  <button
                    key={minute}
                    type="button"
                    aria-label={t("bookings.addAt", { trainer: trainer.fullName, time: clock(minute) })}
                    className="block h-12 w-full border-b transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() =>
                      setPreset({
                        trainerId: trainer.id,
                        date,
                        startTime: clock(minute),
                        endTime: clock(Math.min(minute + DEFAULT_LENGTH_MINUTES, 24 * 60 - 1)),
                      })
                    }
                  />
                ) : (
                  <div key={minute} className="h-12 border-b" />
                ),
              )}
              {bookings
                .filter((b) => b.trainer.id === trainer.id)
                .map((booking) => {
                  const start = minutesOf(booking.scheduledStart);
                  const end = minutesOf(booking.scheduledEnd);
                  return (
                    <button
                      key={booking.id}
                      type="button"
                      data-testid="booking-block"
                      onClick={() => setSelectedId(booking.id)}
                      className={cn(
                        "absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-left text-xs leading-tight",
                        statusSurfaceClass("booking", booking.status),
                      )}
                      // Position and length follow the booking's times.
                      style={{ top: (start - first) * PX_PER_MINUTE + 1, height: Math.max((end - start) * PX_PER_MINUTE - 2, 20) }}
                    >
                      <span className="block font-medium tabular-nums">
                        {t("bookings.timeRange", {
                          start: formatTime(booking.scheduledStart, timeZone),
                          end: formatTime(booking.scheduledEnd, timeZone),
                        })}
                      </span>
                      <span className="block truncate text-foreground">{booking.customer.fullName}</span>
                      <span className="block truncate">{t(`status.booking.${booking.status}`)}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      <BookingSheet booking={selected} onClose={() => setSelectedId(null)} permissions={permissions} trainers={trainers} />
      <BookingFormDialog
        open={preset !== null}
        onOpenChange={(open) => !open && setPreset(null)}
        mode="create"
        preset={preset ?? undefined}
        trainers={trainers}
      />
    </>
  );
}

/** Minutes after midnight as HH:mm. */
function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
