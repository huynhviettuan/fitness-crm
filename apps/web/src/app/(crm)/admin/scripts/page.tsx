import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listScripts } from "@/lib/api/scripts";
import { CreateScriptButton, ScriptsTable } from "./scripts-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scripts");
  return { title: t("title") };
}

/** The consulting script library (FR-LEAD-010, A-072): managed by managers. */
export default async function ScriptsPage() {
  const user = await requirePageUser();
  if (!can(user, "script.manage")) return <ForbiddenState />;

  const t = await getTranslations("scripts");
  const scripts = await listScripts(true);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<CreateScriptButton />} />
      <ScriptsTable scripts={scripts} />
    </>
  );
}
