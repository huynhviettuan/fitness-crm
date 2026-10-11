import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OPENAPI = path.join(import.meta.dirname, "..", "..", "apps", "api", "openapi.json");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type ApiRoute = {
  /** e.g. /api/v1/customers/{id} */
  template: string;
  /** The template with path parameters filled in. */
  path: string;
  methods: string[];
  /** The permission each method declares (`x-permission`); "authenticated" = any signed-in user. */
  permissions: Record<string, string>;
};

/**
 * Every /api/v1 operation, read from the API's OpenAPI document (docs/07), which the
 * API's CI check keeps in step with the controllers. A new endpoint is covered by the
 * access-control tests automatically, so it cannot ship without authentication unnoticed.
 */
export function discoverApiRoutes(): ApiRoute[] {
  const document = JSON.parse(fs.readFileSync(OPENAPI, "utf8")) as {
    paths: Record<string, Record<string, { "x-permission"?: string }>>;
  };
  return Object.entries(document.paths).map(([template, operations]) => {
    const methods = METHODS.filter((method) => method in operations);
    return {
      template,
      path: template.replace(/\{[^}]+\}/g, () => randomUUID()),
      methods: methods.map((method) => method.toUpperCase()),
      permissions: Object.fromEntries(
        methods.map((method) => [method.toUpperCase(), operations[method]["x-permission"] ?? ""]),
      ),
    };
  });
}
