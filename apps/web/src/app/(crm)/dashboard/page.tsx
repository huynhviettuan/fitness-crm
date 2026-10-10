import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LayoutDashboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

// KPIs arrive in Phase 5 (docs/16).
export default async function DashboardPage() {
  const user = await requirePageUser();
  const t = await getTranslations("dashboard");

  return (
    <>
      <PageHeader title={t("title")} description={t("welcome", { name: user.name })} />
      <EmptyState
        icon={LayoutDashboardIcon}
        title={t("comingTitle")}
        description={t("comingBody")}
        action={
          can(user.role, "customer.view") && (
            <Button variant="outline" asChild>
              <Link href="/customers">{t("goToCustomers")}</Link>
            </Button>
          )
        }
      />
    </>
  );
}
