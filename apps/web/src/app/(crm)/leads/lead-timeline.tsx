import { useLocale, useTranslations } from "next-intl";
import { DateTime } from "@/components/date-time";
import { StatusBadge } from "@/components/status-badge";
import type { LeadTimelineEntry } from "@gymcrm/shared/leads";
import type { ChosenOption } from "@gymcrm/shared/options";

/** Every status change, assignment, note, inquiry, and merge, newest first, with who and when (D-020). */
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
            ) : entry.kind === "inquiry" ? (
              <span className="font-medium">{t("inquiry", { channel: chosen(entry.channel) })}</span>
            ) : entry.kind === "note" ? (
              <span className="font-medium">{t("note")}</span>
            ) : entry.kind === "merge" ? (
              <span className="font-medium">
                {t("mergedFrom", {
                  code: entry.mergedLeadCode ?? entry.mergedCustomerCode ?? "",
                  name: entry.mergedName,
                })}
              </span>
            ) : (
              <span className="font-medium">
                {entry.how === "RECLAIM"
                  ? t("reclaimed", {
                      from: entry.from?.name ?? "",
                      to: entry.to.name,
                      minutes: entry.waitedMinutes ?? 0,
                    })
                  : entry.from
                    ? t("reassigned", { from: entry.from.name, to: entry.to.name })
                    : t("assigned", { to: entry.to.name })}
              </span>
            )}
          </div>
          {entry.kind === "status" && entry.appointmentAt && (
            <p className="text-sm">
              {t("appointment")} <DateTime value={entry.appointmentAt} format="dateTime" />
            </p>
          )}
          {entry.kind === "status" && entry.refuseReason && (
            <p className="text-sm">{t("reason", { reason: chosen(entry.refuseReason) })}</p>
          )}
          {entry.kind === "status" && entry.note && (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{entry.note}</p>
          )}
          {entry.kind === "inquiry" && (entry.source || entry.needGroup || entry.needDetail) && (
            <p className="text-sm">
              {[entry.source && chosen(entry.source), entry.needGroup && chosen(entry.needGroup), entry.needDetail]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {entry.kind === "inquiry" && entry.note && (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{entry.note}</p>
          )}
          {entry.kind === "note" && <p className="text-sm whitespace-pre-line">{entry.body}</p>}
          {entry.kind === "merge" && <p className="text-sm">{t("reason", { reason: chosen(entry.reason) })}</p>}
          <p className="text-xs text-muted-foreground">
            <DateTime value={entry.at} format="dateTime" /> ·{" "}
            {entry.by?.name ??
              (entry.kind === "assignment" && entry.how === "ROUND_ROBIN" ? t("roundRobin") : t("system"))}
          </p>
        </li>
      ))}
    </ol>
  );
}
