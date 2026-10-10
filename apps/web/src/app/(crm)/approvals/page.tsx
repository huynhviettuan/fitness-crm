import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { InboxIcon } from "lucide-react";
import { cn } from "cn";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TablePagination } from "@/components/table-pagination";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { listApprovals } from "@/lib/api/approvals";
import { APPROVAL_VIEWS } from "@flow/shared/approvals";
import { ApprovalsTable } from "./approvals-table";

// Reads per-user data on every request (see src/app/(crm)/layout.tsx).
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("approvals");
  return { title: t("title") };
}

/**
 * The approvals inbox (FR-PLT-007): what the user may decide, what they submitted,
 * and — for whoever manages the matrix — everything. Every signed-in user has one.
 */
export default async function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  const user = await requirePageUser();
  const t = await getTranslations("approvals");
  const params = await searchParams;
  const views = APPROVAL_VIEWS.filter((view) => view !== "all" || can(user, "approval.manage"));
  const view = views.find((v) => v === params.view) ?? "toDecide";
  const page = Math.max(1, Number(params.page) || 1);
  const result = await listApprovals({ view, page });
  const hrefFor = (target: number) => `/approvals?view=${view}${target > 1 ? `&page=${target}` : ""}`;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <nav aria-label={t("title")} className="mb-4 flex flex-wrap gap-1 border-b">
        {views.map((v) => (
          <Link
            key={v}
            href={`/approvals?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
              v === view ? "border-primary font-medium text-foreground" : "border-transparent",
            )}
          >
            {t(`views.${v}`)}
          </Link>
        ))}
      </nav>
      <ApprovalsTable
        requests={result.items}
        view={view}
        empty={<EmptyState icon={InboxIcon} title={t(`empty.${view}`)} />}
        footer={<TablePagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />}
      />
    </>
  );
}
