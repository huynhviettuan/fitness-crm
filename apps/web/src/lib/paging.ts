/** Paging shared by every list screen: the page and the rows per page live in the URL. */

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | string[] | undefined): number | undefined {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** A page or size that is missing, malformed, or not on offer falls back to the first page and 20 rows. */
export function readPaging(params: SearchParams): { page: number; pageSize: number } {
  const size = positiveInteger(params.pageSize);
  return {
    page: positiveInteger(params.page) ?? 1,
    pageSize: PAGE_SIZES.some((allowed) => allowed === size) ? (size as number) : DEFAULT_PAGE_SIZE,
  };
}

/** The link to a page of a list: keeps every filter in the URL and leaves default values out of it. */
export function pagingHref(path: string, params: SearchParams, page: number, pageSize: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = first(value);
    if (key !== "page" && key !== "pageSize" && single !== undefined && single !== "") query.set(key, single);
  }
  if (pageSize !== DEFAULT_PAGE_SIZE) query.set("pageSize", String(pageSize));
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
