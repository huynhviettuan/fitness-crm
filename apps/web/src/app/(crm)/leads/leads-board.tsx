import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClockIcon, PhoneCallIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { StatusBadge } from "@/components/status-badge";
import { isRecareStatus, type Lead, type LeadBoard } from "@flow/shared/leads";
import type { ChosenOption } from "@flow/shared/options";

/**
 * The Kanban board (FR-LEAD-006): a column per status. Columns scroll sideways inside
 * the board, so the page itself never does (AC-23); the board is `relative` so that
 * absolutely positioned content, such as screen-reader labels, stays inside it too. A
 * column shows its first cards; the list filtered by that status shows the rest.
 */
export function LeadsBoard({ board, listHref }: { board: LeadBoard; listHref: (status: Lead["status"]) => string }) {
  const t = useTranslations("leads");
  const tStatus = useTranslations("status.lead");

  return (
    <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" role="region" aria-label={t("board")}>
      <div className="flex snap-x snap-mandatory gap-4 sm:snap-none">
        {board.columns.map((column) => (
          <section
            key={column.status}
            aria-label={t("statusColumn", { status: tStatus(column.status) })}
            className="flex w-[17rem] shrink-0 snap-start flex-col gap-3 rounded-lg bg-muted/50 p-3"
          >
            <header className="flex items-center justify-between gap-2">
              <StatusBadge entity="lead" status={column.status} />
              <span className="text-sm text-muted-foreground tabular-nums">{column.total}</span>
            </header>
            {column.items.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("emptyColumn")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {column.items.map((lead) => (
                  <li key={lead.id}>
                    <LeadCard lead={lead} />
                  </li>
                ))}
              </ul>
            )}
            {column.total > column.items.length && (
              <Link
                href={listHref(column.status)}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("seeAllInStatus", { count: column.total })}
              </Link>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const t = useTranslations("leads");
  const locale = useLocale();
  const label = (option: ChosenOption) => (locale === "vi" ? option.labelVi : option.labelEn);

  return (
    <article className="grid gap-1.5 rounded-md border bg-card p-3 text-sm shadow-xs">
      <Link
        href={`/leads/${lead.id}`}
        aria-label={t("open", { name: lead.fullName })}
        className="font-medium underline-offset-4 hover:underline"
      >
        {lead.fullName}
      </Link>
      <p className="font-mono text-xs text-muted-foreground">{lead.leadCode}</p>
      <p className="text-muted-foreground">
        {label(lead.channel)}
        {lead.needGroup && ` · ${label(lead.needGroup)}`}
      </p>
      <p>{lead.pic?.name ?? <span className="text-muted-foreground">{t("noPic")}</span>}</p>
      {lead.status === "BOOKED" && lead.appointmentAt ? (
        <p className="flex items-center gap-1.5">
          <CalendarClockIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{t("fields.appointmentAt")}</span>
          <DateTime value={lead.appointmentAt} format="dateTime" />
        </p>
      ) : isRecareStatus(lead.status) && lead.contactAgainOn ? (
        <p className="flex items-center gap-1.5">
          <PhoneCallIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {t("contactAgain")} <DateTime value={lead.contactAgainOn} format="dateOnly" />
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("since")} <DateTime value={lead.statusChangedAt} />
        </p>
      )}
    </article>
  );
}
