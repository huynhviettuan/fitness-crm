import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listPromotions } from "@/lib/api/promotions";
import { listServices } from "@/lib/api/services";
import { CreatePromotionButton, PromotionsTable } from "./promotions-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("promotions");
  return { title: t("title") };
}

/** Promotions and vouchers (FR-SVC-004, A-110): Admin only. */
export default async function PromotionsPage() {
  const user = await requirePageUser();
  if (!can(user, "promotion.manage")) return <ForbiddenState />;

  const t = await getTranslations("promotions");
  const [promotions, services] = await Promise.all([listPromotions(), listServices()]);
  const choices = services.map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<CreatePromotionButton services={choices} />}
      />
      <PromotionsTable promotions={promotions} services={choices} />
    </>
  );
}
