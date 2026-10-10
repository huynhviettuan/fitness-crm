import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listRoles } from "@/lib/api/roles";
import { listUsers } from "@/lib/api/users";
import { CreateUserButton, UsersTable } from "./users-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("title") };
}

export default async function UsersPage() {
  const user = await requirePageUser();
  if (!can(user, "user.manage")) return <ForbiddenState />;

  const t = await getTranslations("users");
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<CreateUserButton roles={roles.map(({ id, name }) => ({ id, name }))} branches={user.branches} />}
      />
      <UsersTable users={users} currentUserId={user.id} />
    </>
  );
}
