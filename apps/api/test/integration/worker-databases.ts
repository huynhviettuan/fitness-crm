// Integration tests in parallel (review of 2026-10-15): one database per Vitest worker, cloned from the migrated test
// database, so files that truncate tables never meet. Shared by the global setup (creates them) and the per-file setup
// (points the worker at its own).

/** How many files run at once; INTEGRATION_WORKERS=1 runs them one at a time, as before. */
export const INTEGRATION_WORKERS = Math.max(1, Number(process.env.INTEGRATION_WORKERS ?? 4) || 1);

/** postgresql://…/fitness_crm_test → postgresql://…/fitness_crm_test_w3 */
export function workerDatabaseUrl(testUrl: string, worker: number): string {
  const url = new URL(testUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}_w${worker}`;
  return url.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}
