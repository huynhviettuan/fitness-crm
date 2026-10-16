import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ClipboardListIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type { LogSummary, PlanSummary, WorkoutProgress } from "@gymcrm/shared/workouts";
import { CustomerProgress } from "./customer-progress";
import { NewPlanButton } from "../../workouts/new-plan-dialogs";

/** The customer's workout plans (brief §4.2, §7.5): each opens its page; a new one is made blank or from a template. */
export async function CustomerPlans({
  customerId,
  plans,
  logs,
  progress,
  canCreate,
  contracts,
  templates,
  trainers,
}: {
  customerId: string;
  plans: PlanSummary[];
  logs: LogSummary[];
  progress: WorkoutProgress;
  canCreate: boolean;
  contracts: { id: string; label: string }[];
  templates: { id: string; name: string }[];
  trainers: { id: string; name: string }[] | null;
}) {
  const t = await getTranslations("workoutPlans");
  const tl = await getTranslations("workoutLogs");
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <NewPlanButton customerId={customerId} contracts={contracts} templates={templates} trainers={trainers} />
        </div>
      )}
      {plans.length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title={t("customerEmpty")} />
      ) : (
        <ul className="space-y-2" aria-label={t("title")}>
          {plans.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <Link className="font-medium underline-offset-4 hover:underline" href={`/workouts/plans/${plan.id}`}>
                  {plan.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {plan.contract?.contractCode} · {plan.trainer?.fullName} ·{" "}
                  {t("sessionsCount", { count: plan.sessions })} · <DateTime value={plan.planDate} />
                </p>
              </div>
              <StatusBadge entity="plan" status={plan.status} />
            </li>
          ))}
        </ul>
      )}
      <CustomerProgress progress={progress} />
      <section className="space-y-2" aria-label={tl("title")}>
        <h3 className="text-sm font-medium">{tl("title")}</h3>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tl("customerEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div>
                  <Link className="font-medium underline-offset-4 hover:underline" href={`/workouts/logs/${log.id}`}>
                    <DateTime value={log.sessionDate} format="dateTime" />
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {log.trainer.fullName} · {log.plan?.name ?? tl("noPlan")} ·{" "}
                    {tl("exercisesCount", { count: log.exercises })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
