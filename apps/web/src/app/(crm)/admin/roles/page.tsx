import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listRoles } from "@/lib/api/roles";
import { RolesTable } from "./roles-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roles");
  return { title: t("title") };
}

/** FR-PLT-002: roles with their permissions, data scopes, and hidden fields. */
export default async function RolesPage() {
  const user = await requirePageUser();
  if (!can(user, "role.manage")) return <ForbiddenState />;

  const t = await getTranslations("roles");
  const roles = await listRoles();

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild>
            <Link href="/admin/roles/new">
              <PlusIcon />
              {t("create")}
            </Link>
          </Button>
        }
      />
      <RolesTable roles={roles} />
    </>
  );
}
