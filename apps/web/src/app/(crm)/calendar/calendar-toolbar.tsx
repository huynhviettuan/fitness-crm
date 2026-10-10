"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDateOnly } from "@flow/shared/validation";
import type { TrainerOption } from "../bookings/booking-types";

const ALL = "all";

type CalendarToolbarProps = {
  /** The day shown and today, as yyyy-MM-dd (the URL format). */
  day: string;
  today: string;
  trainers: TrainerOption[];
  trainerId?: string;
};

/** Date selector and trainer filter (FR-BOO-004). Everything lives in the URL. */
export function CalendarToolbar({ day, today, trainers, trainerId }: CalendarToolbarProps) {
  const t = useTranslations("bookings");
  const router = useRouter();
  const [goTo, setGoTo] = useState("");

  const hrefFor = (target: string, trainer = trainerId) => {
    const query = new URLSearchParams({ date: target });
    if (trainer) query.set("trainer", trainer);
    return `/calendar?${query}`;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label={t("previousDay")} asChild>
        <Link href={hrefFor(shiftDay(day, -1))}>
          <ChevronLeftIcon />
        </Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href={hrefFor(today)} aria-current={day === today ? "date" : undefined}>
          {t("today")}
        </Link>
      </Button>
      <Button variant="outline" size="icon" aria-label={t("nextDay")} asChild>
        <Link href={hrefFor(shiftDay(day, 1))}>
          <ChevronRightIcon />
        </Link>
      </Button>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const date = parseDateOnly(goTo);
          if (date) router.push(hrefFor(date.toISOString().slice(0, 10)));
        }}
      >
        <Input
          value={goTo}
          onChange={(event) => setGoTo(event.target.value)}
          placeholder={t("datePlaceholder")}
          aria-label={t("goToDate")}
          inputMode="numeric"
          className="w-32"
        />
        <Button type="submit" variant="outline">
          {t("goToDate")}
        </Button>
      </form>
      {trainers.length > 1 && (
        <Select value={trainerId ?? ALL} onValueChange={(value) => router.push(hrefFor(day, value === ALL ? undefined : value))}>
          <SelectTrigger aria-label={t("fields.trainer")} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allTrainers")}</SelectItem>
            {trainers.map((trainer) => (
              <SelectItem key={trainer.id} value={trainer.id}>
                {trainer.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
