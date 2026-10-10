import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listTrainerLogins, listTrainers } from "@/modules/trainers/trainer.service";
import { CreateTrainerButton, TrainersTable } from "./trainers-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trainers");
  return { title: t("title") };
}

export default async function TrainersPage() {
  const user = await requirePageUser();
  if (!can(user.role, "trainer.manage")) return <ForbiddenState />;

  const t = await getTranslations("trainers");
  const [trainers, logins] = await Promise.all([listTrainers(user), listTrainerLogins(user)]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<CreateTrainerButton logins={logins} />} />
      <TrainersTable trainers={trainers} logins={logins} />
    </>
  );
}
