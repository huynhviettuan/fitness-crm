import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { getNotificationPreferences, getPushKey } from "@/lib/api/staff-notifications";
import { PreferencesForm } from "./preferences-form";
import { PushDevice } from "./push-device";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("staffNotifications");
  return { title: t("title") };
}

/** What reaches the signed-in employee by email and on their phone, and this device (M6.4, D-053, D-056). */
export default async function AccountNotificationsPage() {
  await requirePageUser();
  const t = await getTranslations("staffNotifications");
  const [preferences, key] = await Promise.all([getNotificationPreferences(), getPushKey()]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="max-w-3xl space-y-6">
        <PushDevice publicKey={key.publicKey} devices={preferences.pushDevices} />
        <PreferencesForm preferences={preferences} />
      </div>
    </>
  );
}
