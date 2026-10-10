import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type TablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  /** Builds the link for a page, keeping the current search and filters. */
  hrefFor: (page: number) => string;
};

/** Server-side pagination: each page is a link, so it works without client state. */
export function TablePagination({ page, pageSize, total, hrefFor }: TablePaginationProps) {
  const t = useTranslations("common");
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <nav aria-label={t("pageOf", { page, pages })} className="flex items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground">{t("totalResults", { total })}</p>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("pageOf", { page, pages })}</span>
        <PageLink href={page > 1 ? hrefFor(page - 1) : undefined} label={t("previous")}>
          <ChevronLeftIcon />
        </PageLink>
        <PageLink href={page < pages ? hrefFor(page + 1) : undefined} label={t("next")}>
          <ChevronRightIcon />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ href, label, children }: { href?: string; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <Button variant="outline" size="icon-sm" aria-label={label} disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="icon-sm" aria-label={label} asChild>
      <Link href={href}>{children}</Link>
    </Button>
  );
}
