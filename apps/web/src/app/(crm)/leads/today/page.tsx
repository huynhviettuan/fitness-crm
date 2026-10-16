import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getTodaySteps } from "@/lib/api/leads";
import { CompleteStepButton } from "../lead-checklist";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("today");
  return { title: t("title") };
}

/** "Việc hôm nay" (FR-LEAD-005): consulting steps due by the end of the gym's day, overdue first. Phone-first. */
export default async function TodayPage({ searchParams }: PageProps<"/leads/today">) {
  const user = await requirePageUser();
  if (!can(user, "lead.view")) return <ForbiddenState />;

  const t = await getTranslations("today");
  // Not a list filter: here "all" is a scope of its own, so it is read as is.
  const scope = (await searchParams).scope === "all" ? "all" : "mine";
  const { items, overdue } = await getTodaySteps(scope);
  const label = (value: { labelVi: string; labelEn: string }) => (user.locale === "vi" ? value.labelVi : value.labelEn);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label={t("scopes")} className="flex gap-1">
          {(["mine", "all"] as const).map((value) => (
            <Button key={value} asChild size="sm" variant={scope === value ? "secondary" : "ghost"}>
              <Link
                href={value === "mine" ? "/leads/today" : "/leads/today?scope=all"}
                aria-current={scope === value ? "page" : undefined}
              >
                {t(`scope.${value}`)}
              </Link>
            </Button>
          ))}
        </nav>
        <p className="text-sm text-muted-foreground" role="status">
          {t("summary", { count: items.length, overdue })}
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={CalendarCheckIcon} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <ul className="grid gap-2" aria-label={t("title")}>
          {items.map(({ step, lead }) => (
            <li
              key={step.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-3"
            >
              <div className="grid min-w-0 gap-1">
                <Link href={`/leads/${lead.id}`} className="font-medium underline-offset-4 hover:underline">
                  {lead.fullName}
                </Link>
                <p className="text-sm">{label(step)}</p>
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className={step.overdue ? "text-destructive" : undefined}>
                    <DateTime value={step.dueAt!} format="dateTime" />
                  </span>
                  {step.overdue && <Badge variant="destructive">{t("overdue")}</Badge>}
                  <StatusBadge entity="lead" status={lead.status} />
                  <span className="font-mono text-xs">{lead.leadCode}</span>
                  {scope === "all" && <span>{lead.pic?.name ?? t("noPic")}</span>}
                </p>
              </div>
              {can(user, "lead.manage") && <CompleteStepButton leadId={lead.id} leadName={lead.fullName} step={step} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
