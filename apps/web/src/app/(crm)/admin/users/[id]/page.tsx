import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { isApiError } from "@/lib/api/errors";
import { listRoles } from "@/lib/api/roles";
import { getUser, listLoginHistory } from "@/lib/api/users";
import { AccessHoursForm, LoginHistory, OverridesForm, UserAccessForm } from "./user-detail";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

async function loadUser(id: string) {
  try {
    return await getUser(id);
  } catch (error) {
    if (isApiError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps<"/admin/users/[id]">): Promise<Metadata> {
  const user = await requirePageUser();
  if (!can(user, "user.manage")) return {};
  return { title: (await loadUser((await params).id)).name };
}

/** FR-PLT-001: a user's details, own permissions, sign-in hours, and sign-in history. */
export default async function UserPage({ params }: PageProps<"/admin/users/[id]">) {
  const me = await requirePageUser();
  if (!can(me, "user.manage")) return <ForbiddenState />;

  const t = await getTranslations("users");
  const target = await loadUser((await params).id);
  const [roles, logins] = await Promise.all([listRoles(), listLoginHistory(target.id, { page: 1 })]);
  const role = roles.find((r) => r.id === target.role.id);
  // Branches to choose from: the admin's, plus any the user already has (e.g. now inactive).
  const branches = [...me.branches, ...target.branches.filter((b) => !me.branches.some((mine) => mine.id === b.id))];
  // An admin cannot change their own access (CANNOT_CHANGE_OWN_ACCESS).
  const readOnly = target.id === me.id;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/admin/users">
          <ArrowLeftIcon />
          {t("back")}
        </Link>
      </Button>
      <PageHeader
        title={target.name}
        description={target.email}
        actions={<StatusBadge entity="user" status={target.status} />}
      />
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">{t("tabs.info")}</TabsTrigger>
          <TabsTrigger value="permissions">{t("tabs.permissions")}</TabsTrigger>
          <TabsTrigger value="accessHours">{t("tabs.accessHours")}</TabsTrigger>
          <TabsTrigger value="logins">{t("tabs.logins")}</TabsTrigger>
        </TabsList>
        <TabsContent value="info">
          <UserAccessForm
            user={target}
            roles={roles.map(({ id, name }) => ({ id, name }))}
            branches={branches}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="permissions">
          <OverridesForm
            userId={target.id}
            roleName={target.role.name}
            rolePermissions={role?.permissions ?? []}
            overrides={target.overrides}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="accessHours">
          <AccessHoursForm userId={target.id} windows={target.accessWindows} readOnly={readOnly} />
        </TabsContent>
        <TabsContent value="logins">
          <LoginHistory events={logins.items} />
        </TabsContent>
      </Tabs>
    </>
  );
}
