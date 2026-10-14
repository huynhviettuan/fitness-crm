import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { isApiError } from "@/lib/api/errors";
import { getEmailTemplate } from "@/lib/api/mail";
import { can } from "@/lib/permissions";
import { TemplateEditor } from "./template-editor";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("emailTemplates");
  return { title: t("title") };
}

export default async function EmailTemplatePage({ params }: PageProps<"/admin/email-templates/[event]">) {
  const user = await requirePageUser();
  if (!can(user, "mail.template")) return <ForbiddenState />;

  const { event } = await params;
  const template = await getEmailTemplate(event).catch((error) => {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const locale = await getLocale();
  const t = await getTranslations("emailTemplates");

  return (
    <>
      <PageHeader title={locale === "vi" ? template.nameVi : template.nameEn} description={t("editDescription")} />
      <TemplateEditor template={template} />
    </>
  );
}
