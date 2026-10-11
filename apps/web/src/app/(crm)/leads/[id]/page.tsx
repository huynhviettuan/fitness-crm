import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTime } from "@/components/date-time";
import { ForbiddenState } from "@/components/forbidden-state";
import { HiddenValue } from "@/components/hidden-value";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { can } from "@/lib/permissions";
import { getLead, getLeadTimeline, listLeadAssignees } from "@/lib/api/leads";
import { isRecareStatus } from "@flow/shared/leads";
import type { ChosenOption } from "@flow/shared/options";
import { EditLeadButton } from "../lead-form";
import { AssignLeadButton, ChangeStatusButton } from "../lead-journey";
import { LeadTimeline } from "../lead-timeline";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

async function loadLead(id: string) {
  try {
    return await getLead(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/leads/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "lead.view")) return {};
  const lead = await loadLead((await params).id);
  return { title: `${lead.leadCode} · ${lead.fullName}` };
}

/** One lead (FR-LEAD-006): its journey and history, profile, and need. The checklist arrives in M2 slice 3. */
export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "lead.view")) return <ForbiddenState />;

  const t = await getTranslations("leads");
  const lead = await loadLead((await params).id);
  const [timeline, assignees] = await Promise.all([
    getLeadTimeline(lead.id),
    can(user, "lead.assign") ? listLeadAssignees(lead.id) : null,
  ]);
  const chosen = (option: ChosenOption | null) => {
    if (!option) return null;
    const label = user.locale === "vi" ? option.labelVi : option.labelEn;
    return option.note ? `${label}: ${option.note}` : label;
  };
  const masked = (field: "phone" | "email", value: string | null) =>
    lead.maskedFields.includes(field) ? <HiddenValue /> : value;

  const journey: { label: string; value: React.ReactNode }[] = [
    {
      label: t("fields.status"),
      value: (
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge entity="lead" status={lead.status} />
          <span className="text-muted-foreground">
            {t("since")} <DateTime value={lead.statusChangedAt} format="dateTime" />
          </span>
        </span>
      ),
    },
    { label: t("fields.pic"), value: lead.pic?.name ?? t("noPic") },
    ...(lead.appointmentAt
      ? [{ label: t("fields.appointmentAt"), value: <DateTime value={lead.appointmentAt} format="dateTime" /> }]
      : []),
    ...(lead.refuseReason ? [{ label: t("fields.refuseReason"), value: chosen(lead.refuseReason) }] : []),
    ...(isRecareStatus(lead.status) && lead.contactAgainOn
      ? [{ label: t("fields.contactAgainOn"), value: <DateTime value={lead.contactAgainOn} format="dateOnly" /> }]
      : []),
  ];
  const contact: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.leadCode"), value: <span className="font-mono">{lead.leadCode}</span> },
    { label: t("fields.phone"), value: masked("phone", lead.phone) },
    { label: t("fields.email"), value: masked("email", lead.email) },
    { label: t("fields.channel"), value: chosen(lead.channel) },
    { label: t("fields.source"), value: chosen(lead.source) },
    { label: t("fields.sourceType"), value: lead.sourceType && t(`sourceTypes.${lead.sourceType}`) },
    { label: t("fields.sourceDetail"), value: lead.sourceDetail },
    { label: t("fields.branch"), value: lead.branch.name },
    { label: t("fields.createdAt"), value: <DateTime value={lead.createdAt} format="dateTime" /> },
    { label: t("fields.createdBy"), value: lead.createdBy?.name },
  ];
  const need: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.needGroup"), value: chosen(lead.needGroup) },
    {
      label: t("fields.needDetail"),
      value: lead.needDetail && <span className="whitespace-pre-line">{lead.needDetail}</span>,
    },
    { label: t("fields.painStatus"), value: chosen(lead.painStatus) },
    { label: t("fields.assessmentType"), value: chosen(lead.assessmentType) },
    { label: t("fields.gender"), value: lead.gender && t(`genders.${lead.gender}`) },
    { label: t("fields.birthDate"), value: lead.birthDate && <DateTime value={lead.birthDate} format="dateOnly" /> },
    {
      label: t("fields.nationalityGroup"),
      value: lead.nationalityGroup && t(`nationalityGroups.${lead.nationalityGroup}`),
    },
    { label: t("fields.notes"), value: lead.notes && <span className="whitespace-pre-line">{lead.notes}</span> },
  ];
  const list = (items: { label: string; value: React.ReactNode }[]) => (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="text-sm break-words">{item.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/leads">
          <ArrowLeftIcon />
          {t("backToList")}
        </Link>
      </Button>
      <PageHeader
        title={lead.fullName}
        description={lead.leadCode}
        actions={can(user, "lead.manage") && <EditLeadButton lead={lead} />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card role="region" aria-label={t("journey")}>
          <CardHeader>
            <CardTitle>{t("journey")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {list(journey)}
            {(can(user, "lead.manage") || assignees) && (
              <div className="flex flex-wrap gap-2">
                {can(user, "lead.manage") && <ChangeStatusButton lead={lead} />}
                {assignees && <AssignLeadButton lead={lead} assignees={assignees} />}
              </div>
            )}
          </CardContent>
        </Card>
        <Card role="region" aria-label={t("history")}>
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadTimeline entries={timeline.items} />
          </CardContent>
        </Card>
        <Card role="region" aria-label={t("profile")}>
          <CardHeader>
            <CardTitle>{t("profile")}</CardTitle>
          </CardHeader>
          <CardContent>{list(contact)}</CardContent>
        </Card>
        <Card role="region" aria-label={t("need")}>
          <CardHeader>
            <CardTitle>{t("need")}</CardTitle>
          </CardHeader>
          <CardContent>{list(need)}</CardContent>
        </Card>
      </div>
    </>
  );
}
