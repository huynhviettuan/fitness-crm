// Filters of the shared list template (docs/23 §8), read from the URL on the server.

/** The value a filter select sends for "all". */
export const ALL = "all";

/** A query parameter as a filter value: a single string, with "all" and "" meaning none. */
export function filterValue(param: string | string[] | undefined): string | undefined {
  return typeof param === "string" && param.trim() !== "" && param !== ALL ? param.trim() : undefined;
}
