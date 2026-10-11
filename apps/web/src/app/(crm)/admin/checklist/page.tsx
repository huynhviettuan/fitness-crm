import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { DateTime } from "@/components/date-time";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getChecklist } from "@/lib/api/leads";
import { ChecklistEditor } from "./checklist-editor";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checklistAdmin");
  return { title: t("title") };
}

/** The consulting checklist new leads get (D-020, brief §4.1); saving makes a new version. */
export default async function ChecklistPage() {
  const user = await requirePageUser();
  if (!can(user, "config.manage")) return <ForbiddenState />;

  const t = await getTranslations("checklistAdmin");
  const checklist = await getChecklist();

  return (
    <>
      <PageHeader
        title={t("title")}
        description={
          <>
            {t("description")}{" "}
            <span className="whitespace-nowrap">
              {t("version", { version: checklist.version })} ·{" "}
              <DateTime value={checklist.createdAt} format="dateTime" />
              {checklist.createdBy && ` · ${checklist.createdBy.name}`}
            </span>
          </>
        }
      />
      <ChecklistEditor key={checklist.version} checklist={checklist} />
    </>
  );
}
