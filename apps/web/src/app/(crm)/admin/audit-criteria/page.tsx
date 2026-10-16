import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listAuditCriteria } from "@/lib/api/lead-audit";
import { CriteriaForm } from "./criteria-form";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auditCriteria");
  return { title: t("title") };
}

/** What the automatic consulting audit asks of every lead (A-083): a switch and a weight each. */
export default async function AuditCriteriaPage() {
  const user = await requirePageUser();
  if (!can(user, "config.manage")) return <ForbiddenState />;

  const t = await getTranslations("auditCriteria");
  const criteria = await listAuditCriteria();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <CriteriaForm criteria={criteria} />
    </>
  );
}
