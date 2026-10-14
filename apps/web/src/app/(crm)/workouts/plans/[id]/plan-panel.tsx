"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/components/notify";
import { useErrorMessage } from "@/components/use-error-message";
import type { Plan } from "@flow/shared/workouts";
import { reviewPlanAction, revisePlanAction } from "../../actions";

/** Starts a revision of an approved plan: a draft copy that replaces it once the Master approves it (D-022 for plans). */
export function ReviseButton({ plan }: { plan: Plan }) {
  const t = useTranslations("workoutPlans");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  if (!plan.can.revise) return null;
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revisePlanAction(plan.id);
          if (!result.ok) return void notify.error(errorMessage(result.code));
          notify.success(t("revisionStarted"));
          router.push(`/workouts/plans/${result.data.id}`);
        })
      }
    >
      {t("revise")}
    </Button>
  );
}

/** Where a plan stands in its revisions: what it replaces, and what is being written to replace it. */
export function RevisionLinks({ plan }: { plan: Plan }) {
  const t = useTranslations("workoutPlans");
  return (
    <ul className="space-y-1 text-sm">
      {plan.previousPlanId && (
        <li>
          <Link className="underline underline-offset-4" href={`/workouts/plans/${plan.previousPlanId}`}>
            {t("replaces")}
          </Link>
        </li>
      )}
      {plan.revisionId && (
        <li>
          <Link className="underline underline-offset-4" href={`/workouts/plans/${plan.revisionId}`}>
            {plan.status === "SUPERSEDED" ? t("replacedBy") : t("revisionOf")}
          </Link>
        </li>
      )}
    </ul>
  );
}

/** The coach's and the Master's evaluation and note (brief §7.2): each side writes its own. */
export function Reviews({ plan }: { plan: Plan }) {
  const t = useTranslations("workoutPlans");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Review
        plan={plan}
        side="PT"
        evaluation={plan.ptEvaluation}
        note={plan.ptNote}
        editable={plan.can.reviewAsPt}
        title={t("reviews.PT")}
      />
      <Review
        plan={plan}
        side="MASTER"
        evaluation={plan.masterEvaluation}
        note={plan.masterNote}
        editable={plan.can.reviewAsMaster}
        title={t("reviews.MASTER")}
      />
    </div>
  );
}

function Review({
  plan,
  side,
  evaluation,
  note,
  editable,
  title,
}: {
  plan: Plan;
  side: "PT" | "MASTER";
  evaluation: string | null;
  note: string | null;
  editable: boolean;
  title: string;
}) {
  const t = useTranslations("workoutPlans");
  const common = useTranslations("common");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ evaluation: evaluation ?? "", note: note ?? "" });

  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable ? (
          <>
            <Textarea
              aria-label={`${title} · ${t("reviews.evaluation")}`}
              placeholder={t("reviews.evaluation")}
              value={values.evaluation}
              onChange={(event) => setValues({ ...values, evaluation: event.target.value })}
            />
            <Textarea
              aria-label={`${title} · ${t("reviews.note")}`}
              placeholder={t("reviews.note")}
              value={values.note}
              onChange={(event) => setValues({ ...values, note: event.target.value })}
            />
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await reviewPlanAction(plan.id, { side, ...values });
                  if (!result.ok) return void notify.error(errorMessage(result.code));
                  notify.success(t("reviews.saved"));
                  router.refresh();
                })
              }
            >
              {pending ? common("saving") : common("save")}
            </Button>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="whitespace-pre-line">{evaluation ?? "—"}</p>
            {note && <p className="whitespace-pre-line text-muted-foreground">{note}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
