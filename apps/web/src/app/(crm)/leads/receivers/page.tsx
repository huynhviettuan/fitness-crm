import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listLeadReceivers } from "@/lib/api/lead-receivers";
import { ReceiversTable } from "./receivers-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("leadReceivers");
  return { title: t("title") };
}

/** Who receives leads, and how often (D-050): the switch for leave or busy days, and the turn weight. */
export default async function LeadReceiversPage() {
  const user = await requirePageUser();
  if (!can(user, "lead.assign")) return <ForbiddenState />;

  const t = await getTranslations("leadReceivers");
  const receivers = await listLeadReceivers();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ReceiversTable receivers={receivers} />
    </>
  );
}
