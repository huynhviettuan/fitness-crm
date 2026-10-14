import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ClipboardListIcon } from "lucide-react";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type { PlanSummary } from "@flow/shared/workouts";
import { NewPlanButton } from "../../workouts/new-plan-dialogs";

/** The customer's workout plans (brief §4.2, §7.5): each opens its page; a new one is made blank or from a template. */
export async function CustomerPlans({
  customerId,
  plans,
  canCreate,
  contracts,
  templates,
  trainers,
}: {
  customerId: string;
  plans: PlanSummary[];
  canCreate: boolean;
  contracts: { id: string; label: string }[];
  templates: { id: string; name: string }[];
  trainers: { id: string; name: string }[] | null;
}) {
  const t = await getTranslations("workoutPlans");
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
    </div>
  );
}
