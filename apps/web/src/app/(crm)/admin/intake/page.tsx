import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listIntakeSources } from "@/lib/api/intake";
import { SourcesPanel } from "./sources-panel";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("intake");
  return { title: t("title") };
}

/** The connections that hand leads to the system, each with its own key (brief §11, D-044; M10.1). */
export default async function IntakePage() {
  const user = await requirePageUser();
  if (!can(user, "intake.manage")) return <ForbiddenState />;

  const t = await getTranslations("intake");
  const sources = await listIntakeSources();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SourcesPanel sources={sources} branches={user.branches} />
    </>
  );
}
