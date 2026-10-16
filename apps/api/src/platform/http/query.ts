import type { Request } from "express";

/**
 * The named query parameters of a request, each as its first string value. Services
 * validate them; unknown parameters are ignored.
 */
export function queryOf<const K extends string>(request: Request, names: readonly K[]): Record<K, string | undefined> {
  const url = new URL(request.originalUrl, "http://api.invalid");
  return Object.fromEntries(names.map((name) => [name, url.searchParams.get(name) ?? undefined])) as Record<
    K,
    string | undefined
  >;
}
