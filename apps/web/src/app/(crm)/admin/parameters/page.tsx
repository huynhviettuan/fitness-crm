import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getParameters, listOptions } from "@/lib/api/configuration";
import { ParametersForm } from "./parameters-form";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("parameters");
  return { title: t("title") };
}

/** FR-PLT-006, T-049. */
export default async function ParametersPage() {
  const user = await requirePageUser();
  if (!can(user, "config.manage")) return <ForbiddenState />;

  const t = await getTranslations("parameters");
  const [parameters, departments] = await Promise.all([getParameters(), listOptions("departments")]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ParametersForm parameters={parameters} departments={departments} />
    </>
  );
}
