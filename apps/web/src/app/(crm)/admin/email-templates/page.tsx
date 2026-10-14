import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { DateTime } from "@/components/date-time";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listEmailTemplates } from "@/lib/api/mail";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("emailTemplates");
  return { title: t("title") };
}

/** The customer emails and their words, in Vietnamese and English (M6.2, FR-MAIL-001). */
export default async function EmailTemplatesPage() {
  const user = await requirePageUser();
  if (!can(user, "mail.template")) return <ForbiddenState />;

  const t = await getTranslations("emailTemplates");
  const locale = await getLocale();
  const templates = await listEmailTemplates();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ul className="grid gap-3" aria-label={t("title")}>
        {templates.map((template) => (
          <li key={template.event}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <Link
                    href={`/admin/email-templates/${template.event}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {locale === "vi" ? template.nameVi : template.nameEn}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {template.updatedAt && template.updatedBy ? (
                      <>
                        {t("editedBy", { name: template.updatedBy })}{" "}
                        <DateTime value={template.updatedAt} format="dateTime" />
                      </>
                    ) : (
                      t("original")
                    )}
                  </p>
                </div>
                {template.mandatory ? (
                  <Badge variant="info">{t("mandatory")}</Badge>
                ) : (
                  <Badge variant={template.enabled ? "success" : "muted"}>
                    {template.enabled ? t("on") : t("off")}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
