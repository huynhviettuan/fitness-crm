import { useLocale, useTranslations } from "next-intl";
import { DateTime } from "@/components/date-time";
import { StatusBadge } from "@/components/status-badge";
import type { LeadTimelineEntry } from "@flow/shared/leads";
import type { ChosenOption } from "@flow/shared/options";

/** Every status change and assignment of the lead, newest first, with who and when (D-020). */
export function LeadTimeline({ entries }: { entries: LeadTimelineEntry[] }) {
  const t = useTranslations("leads.timeline");
  const locale = useLocale();
  const chosen = (option: ChosenOption) => {
    const label = locale === "vi" ? option.labelVi : option.labelEn;
    return option.note ? `${label}: ${option.note}` : label;
  };

  return (
    <ol className="space-y-4">
      {entries.map((entry) => (
        <li key={`${entry.kind}-${entry.id}`} className="grid gap-1 border-l-2 border-border pl-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {entry.kind === "status" ? (
              entry.fromStatus === null ? (
                <span className="font-medium">{t("created")}</span>
              ) : (
                <>
                  <StatusBadge entity="lead" status={entry.fromStatus} />
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">{t("to")}</span>
                  <StatusBadge entity="lead" status={entry.toStatus} />
                </>
              )
            ) : (
              <span className="font-medium">
                {entry.from ? t("reassigned", { from: entry.from.name, to: entry.to.name }) : t("assigned", { to: entry.to.name })}
              </span>
            )}
          </div>
          {entry.kind === "status" && entry.appointmentAt && (
            <p className="text-sm">
              {t("appointment")} <DateTime value={entry.appointmentAt} format="dateTime" />
            </p>
          )}
          {entry.kind === "status" && entry.refuseReason && <p className="text-sm">{t("reason", { reason: chosen(entry.refuseReason) })}</p>}
          {entry.kind === "status" && entry.note && <p className="text-sm whitespace-pre-line text-muted-foreground">{entry.note}</p>}
          <p className="text-xs text-muted-foreground">
            <DateTime value={entry.at} format="dateTime" /> · {entry.by?.name ?? (entry.kind === "assignment" ? t("roundRobin") : t("system"))}
          </p>
        </li>
      ))}
    </ol>
  );
}
