import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LayoutDashboardIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getOverview } from "@/lib/api/reports";
import { PeriodFilters, readPeriodParams } from "../reports/report-filters";
import { OverviewView } from "./overview-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

/** The overview (docs/10, M5.6) for the roles that have the report; everyone else gets a way into their work. */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requirePageUser();
  const t = await getTranslations("dashboard");

  if (!can(user, "report.overview")) {
    return (
      <>
        <PageHeader title={t("title")} description={t("welcome", { name: user.name })} />
        <EmptyState
          icon={LayoutDashboardIcon}
          title={t("comingTitle")}
          description={t("comingBody")}
          action={
            can(user, "customer.view") && (
              <Button variant="outline" asChild>
                <Link href="/customers">{t("goToCustomers")}</Link>
              </Button>
            )
          }
        />
      </>
    );
  }

  const values = readPeriodParams(await searchParams, user.branches);
  const overview = await getOverview(values);
  return (
    <>
      <PageHeader title={t("title")} description={t("welcome", { name: user.name })} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <PeriodFilters path="/dashboard" values={values} branches={user.branches} />
        <OverviewView overview={overview} />
      </div>
    </>
  );
}
