"use client";

import { useState } from "react";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { TZDate } from "@date-fns/tz";
import { cn } from "cn";
import { colorSurfaceClass } from "@/components/status-badge";
import { formatTime } from "@/lib/format";
import { BookingFormDialog, type BookingPreset } from "../bookings/booking-form";
import { BookingSheet } from "../bookings/booking-sheet";
import type { BookingPermissions, BookingRow, TrainerOption } from "../bookings/booking-types";
import { minutesOfTime } from "@gymcrm/shared/employees";
import type { GridColumn } from "./calendar-types";

const SLOT_MINUTES = 30;
// Height of one 30-minute row in pixels (h-12).
const SLOT_HEIGHT = 48;
const PX_PER_MINUTE = SLOT_HEIGHT / SLOT_MINUTES;
const DEFAULT_LENGTH_MINUTES = 60;

type TrainerScheduleGridProps = {
  /** One column per trainer (day view) or per day (week view). */
  columns: GridColumn[];
  /** The bookings shown that hold the trainer's time (A-024); a cancelled one frees the slot. */
  bookings: BookingRow[];
  /** The configured calendar hours, as minutes after midnight (D-030). */
  dayStart: number;
  dayEnd: number;
  permissions: BookingPermissions;
  /** Trainers a booking can be given to, for the create and reschedule forms. */
  trainers: TrainerOption[];
};

/**
 * The PT grid (docs/23 §9, M5.2): 30-minute rows, one column per trainer or per day. Every cell can be booked
 * (D-058); the cells inside the trainer's on-duty shift are plain and the others are tinted, which only informs.
 * Clicking a booking opens its sheet. Hours outside the configured range appear when a booking needs them.
 */
export function TrainerScheduleGrid({
  columns,
  bookings,
  dayStart,
  dayEnd,
  permissions,
  trainers,
}: TrainerScheduleGridProps) {
  const t = useTranslations();
  const timeZone = useTimeZone() ?? "UTC";
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preset, setPreset] = useState<BookingPreset | null>(null);
  const selected = bookings.find((b) => b.id === selectedId) ?? null;

  const local = (instant: Date) => new TZDate(instant, timeZone);
  const minutesOf = (instant: Date) => local(instant).getHours() * 60 + local(instant).getMinutes();
  const dayOf = (instant: Date) => {
    const at = local(instant);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  };
  let first = dayStart;
  let last = dayEnd;
  for (const booking of bookings) {
    first = Math.min(first, Math.floor(minutesOf(booking.scheduledStart) / SLOT_MINUTES) * SLOT_MINUTES);
    last = Math.max(last, Math.ceil(minutesOf(booking.scheduledEnd) / SLOT_MINUTES) * SLOT_MINUTES);
  }
  const slots = Array.from({ length: (last - first) / SLOT_MINUTES }, (_, i) => first + i * SLOT_MINUTES);
  const onDuty = (column: GridColumn, minute: number) =>
    column.workingHours.some(
      (hours) => minutesOfTime(hours.start) <= minute && minute + SLOT_MINUTES <= minutesOfTime(hours.end),
    );
  const bookable = (column: GridColumn) => permissions.manage && trainers.some((tr) => tr.id === column.trainerId);
  const bookingsOf = (column: GridColumn) =>
    bookings.filter((b) => b.trainer.id === column.trainerId && dayOf(b.scheduledStart) === column.dayKey);

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <div
          className="grid min-w-fit"
          // Layout only: one narrow time column, then one column per trainer or day.
          style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(8rem, 1fr))` }}
        >
          <div className="sticky top-0 left-0 z-10 border-b bg-background" />
          {columns.map((column) => (
            <div key={column.key} className="sticky top-0 border-b border-l bg-background px-3 py-2 text-sm">
              <div className="truncate font-medium">{column.label}</div>
              <div className="truncate text-xs text-muted-foreground">
                {column.sublabel && <span>{column.sublabel} · </span>}
                {t("bookings.sessionCount", { count: bookingsOf(column).length })}
              </div>
            </div>
          ))}

          <div className="sticky left-0 z-10 bg-background">
            {slots.map((minute) => (
              <div
                key={minute}
                className="h-12 border-b pt-1 pr-2 text-right text-xs text-muted-foreground tabular-nums"
              >
                {clock(minute)}
              </div>
            ))}
          </div>
          {columns.map((column) => (
            <div key={column.key} role="group" aria-label={column.label} className="relative border-l">
              {slots.map((minute) => {
                const duty = onDuty(column, minute);
                const cell = cn("block h-12 w-full border-b", !duty && "bg-muted/60");
                return bookable(column) ? (
                  <button
                    key={minute}
                    type="button"
                    data-on-duty={duty}
                    aria-label={t("bookings.addAt", { trainer: column.label, time: clock(minute) })}
                    className={cn(
                      cell,
                      "transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                    )}
                    onClick={() =>
                      setPreset({
                        trainerId: column.trainerId,
                        date: column.date,
                        startTime: clock(minute),
                        endTime: clock(Math.min(minute + DEFAULT_LENGTH_MINUTES, 24 * 60 - 1)),
                      })
                    }
                  />
                ) : (
                  <div key={minute} data-on-duty={duty} className={cell} />
                );
              })}
              {bookingsOf(column).map((booking) => {
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
                      colorSurfaceClass(booking.statusRule.color),
                    )}
                    // Position and length follow the booking's times.
                    style={{
                      top: (start - first) * PX_PER_MINUTE + 1,
                      height: Math.max((end - start) * PX_PER_MINUTE - 2, 20),
                    }}
                  >
                    <span className="block font-medium tabular-nums">
                      {t("bookings.timeRange", {
                        start: formatTime(booking.scheduledStart, timeZone),
                        end: formatTime(booking.scheduledEnd, timeZone),
                      })}
                    </span>
                    <span className="block truncate text-foreground">{booking.customer.fullName}</span>
                    <span className="block truncate">
                      {locale === "vi" ? booking.statusRule.labelVi : booking.statusRule.labelEn}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="inline-block size-3 rounded-sm border bg-muted/60" />
        {t("bookings.offDutyLegend")}
      </p>

      <BookingSheet
        booking={selected}
        onClose={() => setSelectedId(null)}
        permissions={permissions}
        trainers={trainers}
      />
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
