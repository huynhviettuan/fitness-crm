import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listBranches } from "@/lib/api/branches";
import { BranchesTable, CreateBranchButton } from "./branches-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("branches");
  return { title: t("title") };
}

/** FR-PLT-004, D-014. */
export default async function BranchesPage() {
  const user = await requirePageUser();
  if (!can(user, "branch.manage")) return <ForbiddenState />;

  const t = await getTranslations("branches");
  const branches = await listBranches();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<CreateBranchButton />} />
      <BranchesTable branches={branches} />
    </>
  );
}
