import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DateTime } from "@/components/date-time";
import type { LeadAudit } from "@gymcrm/shared/leads";
import { Percent } from "./audit/audit-tables";

type Outcome = NonNullable<LeadAudit["steps"][number]["outcome"]>;
const OUTCOME_VARIANT = { ON_TIME: "success", LATE: "destructive", SKIPPED: "warning" } as const satisfies Record<
  Outcome,
  "success" | "destructive" | "warning"
>;

/** The automatic audit of one lead (FR-LEAD-011, A-081 to A-083): how each step went and the criteria. */
export function LeadAuditCard({ audit }: { audit: LeadAudit }) {
  const t = useTranslations("leadAudit");
  const locale = useLocale();

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("tab.hint")}</p>
      <dl className="grid gap-4 sm:grid-cols-4">
        {[
          [t("fields.score"), <Percent key="score" value={audit.score} />],
          [t("fields.compliance"), <Percent key="compliance" value={audit.compliance} />],
          [t("fields.late"), audit.late],
          [t("fields.skipped"), audit.skipped],
        ].map(([label, value]) => (
          <div key={String(label)} className="space-y-1">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-label={t("tab.steps")} className="space-y-2">
        <h3 className="text-sm font-medium">{t("tab.steps")}</h3>
        {audit.due === 0 && <p className="text-sm text-muted-foreground">{t("tab.empty")}</p>}
        <ul className="divide-y text-sm">
          {audit.steps.map((step) => (
            <li key={step.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{locale === "vi" ? step.labelVi : step.labelEn}</span>
              <span className="flex items-center gap-3">
                {step.dueAt && (
                  <span className="text-xs text-muted-foreground">
                    <DateTime value={step.dueAt} format="dateTime" />
                  </span>
                )}
                {step.outcome ? (
                  <Badge variant={OUTCOME_VARIANT[step.outcome]}>{t(`tab.outcome.${step.outcome}`)}</Badge>
                ) : (
                  <Badge variant="muted">{t("tab.outcome.none")}</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t("tab.criteria")} className="space-y-2">
        <h3 className="text-sm font-medium">{t("tab.criteria")}</h3>
        <ul className="divide-y text-sm">
          {audit.criteria.map((criterion) => (
            <li key={criterion.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {t(`criteria.${criterion.key}`)}{" "}
                <span className="text-xs text-muted-foreground">{t("tab.weight", { weight: criterion.weight })}</span>
              </span>
              {!criterion.active ? (
                <Badge variant="muted">{t("tab.off")}</Badge>
              ) : !criterion.applies ? (
                <Badge variant="muted">{t("tab.notApplicable")}</Badge>
              ) : criterion.passed ? (
                <Badge variant="success">{t("tab.passed")}</Badge>
              ) : (
                <Badge variant="destructive">{t("tab.failed")}</Badge>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
