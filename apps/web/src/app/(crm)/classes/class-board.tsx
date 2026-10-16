"use client";

import { useState } from "react";
import { useTimeZone, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClassSession } from "@gymcrm/shared/classes";
import { ClassSheet } from "./class-sheet";
import type { ClassPermissions } from "./class-types";

export type BoardDay = { key: string; label: string; sublabel: string; today: boolean; sessions: ClassSession[] };

/**
 * The week of classes: a column per day on a wide screen, one day under the other on a phone (docs/23 §12). Each
 * session shows its time, its coach, and its seats; opening one shows who is enrolled (brief §6.4).
 */
export function ClassBoard({ days, permissions }: { days: BoardDay[]; permissions: ClassPermissions }) {
  const t = useTranslations("classes");
  const timeZone = useTimeZone() ?? "UTC";
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-7" role="list" aria-label={t("boardLabel")}>
        {days.map((day) => (
          <section
            key={day.key}
            role="listitem"
            aria-label={`${day.label} ${day.sublabel}`}
            className={cn("rounded-lg border p-2", day.today && "border-primary")}
          >
            <h3 className="mb-2 flex items-baseline justify-between text-sm font-medium">
              <span>{day.sublabel}</span>
              <span className="text-xs text-muted-foreground">{day.label}</span>
            </h3>
            <ul className="space-y-2">
              {day.sessions.length === 0 && <li className="text-xs text-muted-foreground">{t("noClasses")}</li>}
              {day.sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    data-testid="class-card"
                    onClick={() => setSelected(session.id)}
                    className={cn(
                      "w-full rounded-md border bg-card p-2 text-left text-sm hover:bg-accent",
                      session.status === "CANCELLED" && "opacity-60",
                    )}
                  >
                    <span className="block font-medium tabular-nums">
                      {formatTime(session.startsAt, timeZone)}–{formatTime(session.endsAt, timeZone)}
                    </span>
                    <span className="block truncate">{session.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{session.coach.fullName}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                      <span className="tabular-nums">
                        {t("seats", { taken: session.seatsTaken, capacity: session.capacity })}
                      </span>
                      {session.status === "CANCELLED" && <Badge variant="muted">{t("status.CANCELLED")}</Badge>}
                      {session.taught && <Badge variant="success">{t("taught")}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ClassSheet sessionId={selected} onClose={() => setSelected(null)} permissions={permissions} />
    </>
  );
}
