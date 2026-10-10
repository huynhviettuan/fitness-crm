import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listApprovalRules } from "@/lib/api/approvals";
import { listRoles } from "@/lib/api/roles";
import { ApprovalRulesTable } from "./approval-rules-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("approvalRules");
  return { title: t("title") };
}

/** The approval matrix (D-018, FR-PLT-006): changes take effect at once. */
export default async function ApprovalRulesPage() {
  const user = await requirePageUser();
  if (!can(user, "approval.manage")) return <ForbiddenState />;

  const t = await getTranslations("approvalRules");
  const [rules, roles] = await Promise.all([listApprovalRules(), can(user, "role.manage") ? listRoles() : Promise.resolve([])]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ApprovalRulesTable rules={rules} roles={roles.map((role) => ({ id: role.id, name: role.name }))} />
    </>
  );
}
