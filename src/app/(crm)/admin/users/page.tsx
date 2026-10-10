import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listUsers } from "@/modules/users/user.service";
import { CreateUserButton, UsersTable } from "./users-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");
  return { title: t("title") };
}

export default async function UsersPage() {
  const user = await requirePageUser();
  if (!can(user.role, "user.manage")) return <ForbiddenState />;

  const t = await getTranslations("users");
  const users = await listUsers(user);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<CreateUserButton />} />
      <UsersTable users={users} currentUserId={user.id} />
    </>
  );
}
