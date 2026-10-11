import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForbiddenState } from "@/components/forbidden-state";
import { PageHeader } from "@/components/page-header";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { cn } from "cn";
import { listOptions, listOtherNotes } from "@/lib/api/configuration";
import { OPTION_LISTS, isOptionList } from "@flow/shared/options";
import { CreateOptionButton, OptionsTable, OtherNotesTable } from "./options-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("options");
  return { title: t("title") };
}

/** FR-PLT-005, D-016: one list at a time, chosen on the left. */
export default async function OptionListsPage({ searchParams }: PageProps<"/admin/options">) {
  const user = await requirePageUser();
  if (!can(user, "config.manage")) return <ForbiddenState />;

  const t = await getTranslations("options");
  const requested = (await searchParams).list;
  const listKey = typeof requested === "string" && isOptionList(requested) ? requested : OPTION_LISTS[0];
  const [options, notes] = await Promise.all([listOptions(listKey, true), listOtherNotes(listKey)]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<CreateOptionButton listKey={listKey} />}
      />
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t("listsLabel")}>
          <ul className="flex flex-col gap-1">
            {OPTION_LISTS.map((key) => (
              <li key={key}>
                <Link
                  href={`/admin/options?list=${key}`}
                  aria-current={key === listKey ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm hover:bg-muted",
                    key === listKey && "bg-muted font-medium text-foreground",
                  )}
                >
                  {t(`lists.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <OptionsTable listKey={listKey} options={options} label={t(`lists.${listKey}`)} />
          <Card>
            <CardHeader>
              <CardTitle>{t("otherNotes.title")}</CardTitle>
              <CardDescription>{t("otherNotes.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <OtherNotesTable notes={notes} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
