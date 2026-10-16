import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { SystemStatus } from "@gymcrm/shared/system";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getSystemStatus } from "@/lib/api/system";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("system");
  return { title: t("title") };
}

type State =
  SystemStatus["jobs"][number]["state"] | SystemStatus["backup"]["state"] | SystemStatus["machines"][number]["state"];

const VARIANT: Record<State, "success" | "warning" | "destructive" | "muted"> = {
  ok: "success",
  late: "warning",
  silent: "warning",
  never: "warning",
  failing: "destructive",
  unreadable: "destructive",
  off: "muted",
};

/**
 * The System status page (A-321): what Admin needs to see of the machinery without reading logs: the background jobs,
 * the backups, the customer emails, the check-in machines, and which server settings are on.
 */
export default async function SystemStatusPage() {
  const user = await requirePageUser();
  if (!can(user, "system.view")) return <ForbiddenState />;

  const t = await getTranslations("system");
  const status = await getSystemStatus();
  const state = (value: State) => <Badge variant={VARIANT[value]}>{t(`state.${value}`)}</Badge>;
  const when = (value: Date | null) => (value ? <DateTime value={value} format="dateTime" /> : t("never"));
  const onOff = (value: boolean) => (value ? t("settings.on") : t("settings.offValue"));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <p role="status" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {t("checkedAt")} <DateTime value={status.checkedAt} format="time" />
        </span>
        {status.attention === 0 ? (
          <Badge variant="success">{t("allGood")}</Badge>
        ) : (
          <Badge variant="warning">{t("attention", { count: status.attention })}</Badge>
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("sections.jobs")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3" aria-label={t("sections.jobs")}>
              {status.jobs.map((job) => (
                <li key={job.name} className="space-y-1 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{t(`jobs.${job.name}`)}</span>
                    {state(job.state)}
                  </div>
                  <p className="text-muted-foreground">
                    {t("jobs.lastSucceeded")}: {when(job.lastSucceededAt)}
                    {job.lastFailedAt && (
                      <>
                        {" · "}
                        {t("jobs.lastFailed")}: {when(job.lastFailedAt)}
                      </>
                    )}
                  </p>
                  {job.state === "failing" && job.lastError && (
                    <p className="text-destructive">
                      {t("jobs.error")}: {job.lastError}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.backup")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t("backup.lastAt")}: {when(status.backup.lastAt)}
              </span>
              {state(status.backup.state)}
            </div>
            {status.backup.bytes !== null && (
              <p className="text-muted-foreground">
                {t("backup.size")}: {(status.backup.bytes / 1_048_576).toFixed(1)} MB
              </p>
            )}
            {status.backup.state === "off" && <p className="text-muted-foreground">{t("backup.offHint")}</p>}
            {status.backup.state === "unreadable" && <p className="text-destructive">{t("backup.unreadableHint")}</p>}
            {status.backup.state === "never" && <p className="text-muted-foreground">{t("backup.neverHint")}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.emails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
              <dt>{t("emails.queued")}</dt>
              <dd className="text-right tabular-nums">{status.emails.queued}</dd>
              <dt>{t("emails.stuck")}</dt>
              <dd className="text-right tabular-nums">
                {status.emails.stuck > 0 ? <Badge variant="warning">{status.emails.stuck}</Badge> : 0}
              </dd>
              <dt>{t("emails.failed")}</dt>
              <dd className="text-right tabular-nums">
                {status.emails.failed > 0 ? <Badge variant="destructive">{status.emails.failed}</Badge> : 0}
              </dd>
              <dt>{t("emails.lastSentAt")}</dt>
              <dd className="text-right">{when(status.emails.lastSentAt)}</dd>
            </dl>
            {status.settings.emailDelivery === "record" && (
              <p className="text-muted-foreground">{t("emails.recordHint")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sections.machines")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {status.machines.length === 0 ? (
              <p className="text-muted-foreground">{t("machines.empty")}</p>
            ) : (
              <ul className="space-y-3" aria-label={t("sections.machines")}>
                {status.machines.map((machine) => (
                  <li key={machine.id} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {machine.name} · {machine.branch}
                      </span>
                      <span className="flex gap-1">
                        {machine.clockOff && <Badge variant="warning">{t("machines.clockOff")}</Badge>}
                        {state(machine.state)}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      {t("machines.lastSeenAt")}: {when(machine.lastSeenAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("sections.settings")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
              <dt>{t("settings.environment")}</dt>
              <dd>{status.environment}</dd>
              <dt>{t("settings.release")}</dt>
              <dd className="font-mono text-xs">{status.release?.slice(0, 12) ?? "—"}</dd>
              <dt>{t("settings.emailDelivery")}</dt>
              <dd>{t(`settings.${status.settings.emailDelivery}`)}</dd>
              <dt>{t("settings.fileStorage")}</dt>
              <dd>{t(`settings.${status.settings.fileStorage}`)}</dd>
              <dt>{t("settings.errorMonitoring")}</dt>
              <dd>{onOff(status.settings.errorMonitoring)}</dd>
              <dt>{t("settings.backups")}</dt>
              <dd>{onOff(status.settings.backups)}</dd>
              <dt>{t("settings.jobsInApi")}</dt>
              <dd>{onOff(status.settings.jobsInApi)}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
