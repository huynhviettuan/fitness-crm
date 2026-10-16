import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listBranches } from "@/lib/api/branches";
import { listServices } from "@/lib/api/services";
import { CreateServiceButton, ServicesTable } from "./services-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("services");
  return { title: t("title") };
}

/** Services and price tiers (FR-SVC-001): read by those who sell, edited by Admin. */
export default async function ServicesPage() {
  const user = await requirePageUser();
  if (!can(user, "service.view")) return <ForbiddenState />;

  const t = await getTranslations("services");
  const canManage = can(user, "service.manage");
  const [services, branches] = await Promise.all([listServices(), canManage ? listBranches() : []]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage && (
            <CreateServiceButton
              branches={branches.filter((branch) => branch.active).map(({ id, name }) => ({ id, name }))}
            />
          )
        }
      />
      <ServicesTable services={services} />
    </>
  );
}
