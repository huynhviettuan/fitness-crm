import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { DATA_SCOPE_RESOURCES } from "@flow/shared/permissions";
import { RoleEditor, type EditableRole } from "../role-editor";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("roles");
  return { title: t("create") };
}

// A new role starts with nothing granted and "own" data only: admin opens what it needs.
const EMPTY_ROLE: EditableRole = {
  id: null,
  name: "",
  description: null,
  permissions: [],
  dataScopes: Object.fromEntries(DATA_SCOPE_RESOURCES.map((resource) => [resource, "OWN"])) as EditableRole["dataScopes"],
  fieldMasks: [],
};

export default async function NewRolePage() {
  const user = await requirePageUser();
  if (!can(user, "role.manage")) return <ForbiddenState />;
  const t = await getTranslations("roles");

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/admin/roles">
          <ArrowLeftIcon />
          {t("backToList")}
        </Link>
      </Button>
      <PageHeader title={t("create")} description={t("createDescription")} />
      <RoleEditor role={EMPTY_ROLE} />
    </>
  );
}
