import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API_ROOT = path.join(import.meta.dirname, "..", "..", "src", "app", "api", "v1");
const METHOD_EXPORT = /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

export type ApiRoute = {
  /** e.g. /api/v1/customers/[id] */
  template: string;
  /** The template with dynamic segments filled in. */
  path: string;
  methods: string[];
};

/**
 * Every Route Handler under /api/v1, read from the source tree. A new route is
 * covered by the access-control tests automatically, so it cannot ship without
 * authentication unnoticed.
 */
export function discoverApiRoutes(): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const segments = path.relative(API_ROOT, dir).split(path.sep).filter((s) => s && !s.startsWith("("));
        const template = ["/api/v1", ...segments].join("/");
        const methods = [...fs.readFileSync(full, "utf8").matchAll(METHOD_EXPORT)].map((m) => m[1]);
        routes.push({ template, path: template.replace(/\[[^\]]+\]/g, () => randomUUID()), methods });
      }
    }
  };
  walk(API_ROOT);
  return routes;
}
