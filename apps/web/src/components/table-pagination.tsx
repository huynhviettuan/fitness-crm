import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoToPage } from "@/components/go-to-page";
import { PAGE_PLACEHOLDER, PAGE_SIZES, pagingHref, type PagingKeys, type SearchParams } from "@/lib/paging";

/** A list with more pages than the numbers show gets a box to type the page to go to. */
const JUMP_FROM_PAGES = 5;

type TablePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  /** The list's path and its current search params: page links keep the search and filters. */
  path: string;
  params: SearchParams;
  /** Parameter names of a second list on the same screen; the default ones are page and pageSize. */
  keys?: PagingKeys;
};

/** Server-side pagination: each page and each page size is a link, so it works without client state. */
export function TablePagination({ page, pageSize, total, path, params, keys }: TablePaginationProps) {
  const t = useTranslations("common");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hrefFor = (target: number, size = pageSize) => pagingHref(path, params, target, size, keys);

  return (
    <nav
      aria-label={t("pageOf", { page, pages })}
      className="flex flex-wrap items-center justify-between gap-4 text-sm"
    >
      <p className="text-muted-foreground">{t("totalResults", { total })}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-muted-foreground">{t("rowsPerPage")}</span>
          {PAGE_SIZES.map((size) => (
            <Button
              key={size}
              variant={size === pageSize ? "secondary" : "ghost"}
              size="sm"
              aria-current={size === pageSize ? "true" : undefined}
              asChild
            >
              <Link href={hrefFor(1, size)}>{size}</Link>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <PageLink href={page > 1 ? hrefFor(1) : undefined} label={t("first")}>
            <ChevronsLeftIcon />
          </PageLink>
          <PageLink href={page > 1 ? hrefFor(page - 1) : undefined} label={t("previous")}>
            <ChevronLeftIcon />
          </PageLink>
          {pageWindow(page, pages).map((entry, index) =>
            entry === null ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={entry}
                variant={entry === page ? "secondary" : "ghost"}
                size="sm"
                aria-label={t("goToPage", { page: entry })}
                aria-current={entry === page ? "page" : undefined}
                asChild
              >
                <Link href={hrefFor(entry)}>{entry}</Link>
              </Button>
            ),
          )}
          <PageLink href={page < pages ? hrefFor(page + 1) : undefined} label={t("next")}>
            <ChevronRightIcon />
          </PageLink>
          <PageLink href={page < pages ? hrefFor(pages) : undefined} label={t("last")}>
            <ChevronsRightIcon />
          </PageLink>
        </div>
        {pages > JUMP_FROM_PAGES && (
          <GoToPage pages={pages} firstHref={hrefFor(1)} template={hrefFor(PAGE_PLACEHOLDER)} />
        )}
      </div>
    </nav>
  );
}

/** The first and last page, and the current one with a neighbour on each side; `null` marks a gap. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const shown = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  shown.forEach((n, i) => {
    const before = shown[i - 1];
    if (before !== undefined && n - before > 1) result.push(null);
    result.push(n);
  });
  return result;
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
