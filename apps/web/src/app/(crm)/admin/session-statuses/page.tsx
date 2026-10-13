import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listSessionStatuses } from "@/lib/api/bookings";
import { SessionStatusesTable } from "./session-statuses-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sessionStatuses");
  return { title: t("title") };
}

/** The session statuses and their rules (brief §6.2, D-025, FR-PLT-006). */
export default async function SessionStatusesPage() {
  const user = await requirePageUser();
  if (!can(user, "config.manage")) return <ForbiddenState />;

  const t = await getTranslations("sessionStatuses");
  const statuses = await listSessionStatuses();

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SessionStatusesTable statuses={statuses} />
    </>
  );
}
