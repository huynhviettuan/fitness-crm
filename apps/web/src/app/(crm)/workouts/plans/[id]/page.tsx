import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import { getPlan, listPickableExercises } from "@/lib/api/workout-plans";
import { listStages } from "@/lib/api/workouts";
import { PlanEditor } from "./plan-editor";
import { ReviseButton, Reviews, RevisionLinks } from "./plan-panel";
import { PlanView } from "./plan-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutPlans");
  return { title: t("title") };
}

/** A workout plan or template (M7.2): written while it is a draft, read-only after, revised to change. */
export default async function PlanPage({ params }: PageProps<"/workouts/plans/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutPlans");
  const { id } = await params;
  const plan = await getPlan(id).catch((error) => {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const template = plan.kind === "TEMPLATE";

  const editor = plan.can.edit
    ? await Promise.all([listPickableExercises(), listStages(true)]).then(([exercises, stages]) => {
        const used = new Set(plan.stages.map((stage) => stage.stage.id));
        return { exercises, stages: stages.filter((stage) => stage.active || used.has(stage.id)) };
      })
    : null;

  return (
    <>
      <PageHeader
        title={plan.name}
        description={
          template
            ? t("templateOf", { branch: plan.branch.name })
            : t("planOf", { customer: plan.customer?.fullName ?? "", contract: plan.contract?.contractCode ?? "" })
        }
        actions={
          <>
            <StatusBadge entity="plan" status={plan.status} />
            <ReviseButton plan={plan} />
            <Button variant="outline" asChild>
              <Link href={template ? "/workouts/templates" : "/workouts/plans"}>{t("back")}</Link>
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4" aria-label={t("header")}>
          {plan.customer && (
            <Detail label={t("fields.customer")}>
              <Link className="underline underline-offset-4" href={`/customers/${plan.customer.id}`}>
                {plan.customer.fullName} · {plan.customer.customerCode}
              </Link>
            </Detail>
          )}
          {plan.trainer && <Detail label={t("fields.trainer")}>{plan.trainer.fullName}</Detail>}
          <Detail label={t("fields.date")}>
            <DateTime value={plan.planDate} />
          </Detail>
          {plan.phase && <Detail label={t("fields.phase")}>{plan.phase}</Detail>}
          {plan.goal && <Detail label={t("fields.goal")}>{plan.goal}</Detail>}
          {plan.sourceTemplate && (
            <Detail label={t("fields.template")}>
              <Link className="underline underline-offset-4" href={`/workouts/plans/${plan.sourceTemplate.id}`}>
                {plan.sourceTemplate.name}
              </Link>
            </Detail>
          )}
          <Detail label={t("fields.createdBy")}>{plan.createdBy.name}</Detail>
          {plan.approvedBy && (
            <Detail label={t("fields.approvedBy")}>
              {plan.approvedBy.name}
              {plan.approvedAt && (
                <>
                  {" · "}
                  <DateTime value={plan.approvedAt} format="dateTime" />
                </>
              )}
            </Detail>
          )}
          {plan.notes && <Detail label={t("fields.notes")}>{plan.notes}</Detail>}
        </dl>
        {plan.status === "PENDING" && <p className="text-sm text-muted-foreground">{t("waiting")}</p>}
        {plan.status === "REJECTED" && <p className="text-sm text-destructive">{t("rejected")}</p>}
        <RevisionLinks plan={plan} />
        {editor ? (
          <PlanEditor plan={plan} exercises={editor.exercises} stages={editor.stages} />
        ) : (
          <PlanView plan={plan} />
        )}
        {!template && <Reviews plan={plan} />}
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
