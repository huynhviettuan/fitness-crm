import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { listOptions } from "@/lib/api/configuration";
import { can } from "@/lib/permissions";
import { getLog } from "@/lib/api/workout-logs";
import { listPickableExercises } from "@/lib/api/workout-plans";
import { LogForm } from "./log-form";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workoutLogs");
  return { title: t("title") };
}

/** The log of one PT session (M7.3, brief §7.3): three parts, plan and actual on one row per set. */
export default async function LogPage({ params }: PageProps<"/workouts/logs/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "workout.view")) return <ForbiddenState />;

  const t = await getTranslations("workoutLogs");
  const { id } = await params;
  const log = await getLog(id).catch((error) => {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const [flags, actions, impacts, summaries, exercises] = await Promise.all([
    listOptions("workoutFlags"),
    listOptions("workoutActions"),
    listOptions("sessionImpacts"),
    listOptions("sessionSummaries"),
    log.canEdit ? listPickableExercises() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={t("pageTitle", { customer: log.customer.fullName })}
        description={t("pageDescription", { trainer: log.trainer.fullName, contract: log.contract.contractCode })}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/customers/${log.customer.id}`}>{t("customerPage")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/workouts/logs">{t("back")}</Link>
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          <DateTime value={log.sessionDate} format="dateTime" />
        </p>
        <LogForm log={log} options={{ flags, actions, impacts, summaries }} exercises={exercises} />
      </div>
    </>
  );
}
