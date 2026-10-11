import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { listNotifications } from "@/lib/api/notifications";
import { MarkAllReadButton, NotificationList } from "./notification-list";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

/** Every notification of the signed-in user, newest first (FR-PLT-009). */
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  await requirePageUser();
  const t = await getTranslations("notifications");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const result = await listNotifications({ page });
  const hrefFor = (target: number) => (target > 1 ? `/notifications?page=${target}` : "/notifications");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={result.items.some((n) => !n.readAt) && <MarkAllReadButton />} />
      <NotificationList notifications={result.items} />
      <div className="mt-4">
        <TablePagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />
      </div>
    </>
  );
}
