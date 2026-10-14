import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { readPaging } from "@/lib/paging";
import { can } from "@/lib/permissions";
import { listPayouts } from "@/lib/api/payouts";
import { listReportTrainers, readTrainerParams, TrainerFilters } from "../report-filters";
import { PayoutsView } from "./payouts-view";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ptPayouts");
  return { title: t("title") };
}

/** The payouts made to PTs (M5.7, FR-CASH-003): the voucher, the period, and what it paid and took back. */
export default async function PtPayoutsPage({ searchParams }: PageProps<"/reports/pt-payouts">) {
  const user = await requirePageUser();
  if (!can(user, "payout.view")) return <ForbiddenState />;

  const t = await getTranslations("ptPayouts");
  const params = await searchParams;
  const trainers = await listReportTrainers();
  const values = readTrainerParams(params, user.branches, trainers);
  const { page, pageSize } = readPaging(params);
  const result = await listPayouts({ trainerId: values.trainerId, from: values.from, to: values.to, page, pageSize });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <TrainerFilters path="/reports/pt-payouts" values={values} branches={user.branches} trainers={trainers} />
        <PayoutsView result={result} params={params} />
      </div>
    </>
  );
}
