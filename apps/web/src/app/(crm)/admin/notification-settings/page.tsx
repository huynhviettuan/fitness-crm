import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getNotificationSettings } from "@/lib/api/staff-notifications";
import { SettingsForm } from "./settings-form";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationSettings");
  return { title: t("title") };
}

/** Which notifications are mandatory by email and by push (M6.4, D-053). */
export default async function NotificationSettingsPage() {
  const user = await requirePageUser();
  if (!can(user, "config.manage")) return <ForbiddenState />;

  const t = await getTranslations("notificationSettings");
  const settings = await getNotificationSettings();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsForm settings={settings} />
    </>
  );
}
