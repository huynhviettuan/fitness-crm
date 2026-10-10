import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { isApiError } from "@/lib/api/errors";
import { getRole } from "@/lib/api/roles";
import { CloneRoleButton, RoleEditor } from "../role-editor";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

async function loadRole(id: string) {
  try {
    return await getRole(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/admin/roles/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "role.manage")) return {};
  return { title: (await loadRole((await params).id)).name };
}

export default async function RolePage({ params }: PageProps<"/admin/roles/[id]">) {
  const user = await requirePageUser();
  if (!can(user, "role.manage")) return <ForbiddenState />;

  const t = await getTranslations("roles");
  const role = await loadRole((await params).id);

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/admin/roles">
          <ArrowLeftIcon />
          {t("backToList")}
        </Link>
      </Button>
      <PageHeader
        title={role.name}
        description={t("users", { count: role.userCount })}
        actions={<CloneRoleButton role={role} />}
      />
      {/* Remount when navigating between roles, so the form shows the new role. */}
      <RoleEditor key={role.id} role={role} />
    </>
  );
}
