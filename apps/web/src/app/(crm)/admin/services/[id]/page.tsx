import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTimeZone, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { isApiError } from "@/lib/api/errors";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listBranches } from "@/lib/api/branches";
import { getService } from "@/lib/api/services";
import { calendarDateInTimeZone } from "@flow/shared/validation";
import { versionInForce } from "@flow/shared/services";
import { EditServiceButton, LookupCard, PackagesPanel, TiersPanel, type VersionView } from "./service-panels";

async function loadService(id: string) {
  try {
    return await getService(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata({ params }: PageProps<"/admin/services/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "service.view")) return {};
  return { title: (await loadService((await params).id)).name };
}

export default async function ServicePage({ params }: PageProps<"/admin/services/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "service.view")) return <ForbiddenState />;

  const service = await loadService((await params).id);
  const t = await getTranslations("services");
  const canManage = can(user, "service.manage");
  const branches = canManage ? (await listBranches()).filter((branch) => branch.active) : [];

  // The version in force today is the latest that has started; later ones have not (BR-301).
  const today = calendarDateInTimeZone(await getTimeZone());
  const inForce = versionInForce(service.versions, today);
  const versions: VersionView[] = service.versions.map((version) => ({
    ...version,
    state: version.id === inForce?.id ? "inForce" : version.effectiveFrom > today ? "upcoming" : "replaced",
  }));

  const details: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.kind"), value: t(`kinds.${service.kind}`) },
    { label: t("fields.branches"), value: service.branches.map((branch) => branch.name).join(", ") },
    {
      label: t("fields.hours"),
      value: service.allowedFrom ? `${service.allowedFrom} - ${service.allowedTo}` : t("allDay"),
    },
    { label: t("fields.commissionRate"), value: `${service.commissionRate}%` },
    {
      label: t("fields.isGroup"),
      value: service.isGroup ? `${t("fields.maxMembers")}: ${service.maxMembers}` : null,
    },
    {
      label: t("fields.limits"),
      value:
        [
          service.maxPerWeek && t("perWeek", { count: service.maxPerWeek }),
          service.maxPerDay && t("perDay", { count: service.maxPerDay }),
        ]
          .filter(Boolean)
          .join(" · ") || t("noLimit"),
    },
    {
      label: t("fields.validity"),
      value:
        service.activeFrom || service.activeTo ? (
          <>
            {service.activeFrom ? <DateTime value={service.activeFrom} format="dateOnly" /> : "…"}
            {" - "}
            {service.activeTo ? <DateTime value={service.activeTo} format="dateOnly" /> : "…"}
          </>
        ) : (
          t("noLimit")
        ),
    },
    {
      label: t("fields.status"),
      value: <StatusBadge entity="option" status={service.active ? "ACTIVE" : "INACTIVE"} />,
    },
    { label: t("fields.notes"), value: service.notes && <span className="whitespace-pre-line">{service.notes}</span> },
  ];

  return (
    <>
      <PageHeader
        title={service.name}
        description={t(`kinds.${service.kind}`)}
        actions={
          canManage && <EditServiceButton service={service} branches={branches.map(({ id, name }) => ({ id, name }))} />
        }
      />
      <Tabs defaultValue="tiers">
        <TabsList>
          <TabsTrigger value="tiers">{t("tabs.tiers")}</TabsTrigger>
          <TabsTrigger value="packages">{t("tabs.packages")}</TabsTrigger>
          <TabsTrigger value="info">{t("tabs.info")}</TabsTrigger>
        </TabsList>
        <TabsContent value="tiers" className="space-y-4">
          <TiersPanel serviceId={service.id} versions={versions} canManage={canManage} />
          {inForce && <LookupCard serviceId={service.id} />}
        </TabsContent>
        <TabsContent value="packages">
          <PackagesPanel serviceId={service.id} sessions={service.quickPackages} canManage={canManage} />
        </TabsContent>
        <TabsContent value="info">
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>
                <h2>{t("tabs.info")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {details.map(({ label, value }) => (
                  <div key={label} className="space-y-1">
                    <dt className="text-sm text-muted-foreground">{label}</dt>
                    <dd className="text-sm">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
