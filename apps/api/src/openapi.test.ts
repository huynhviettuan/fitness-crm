import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@gymcrm/shared/permissions";

// T-046: every endpoint declares the permission it needs. The guard refuses endpoints
// that do not; this keeps the declarations visible in the contract and valid.
const document = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { "x-permission"?: string }>>;
};
const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    name: `${method.toUpperCase()} ${path}`,
    permission: operation["x-permission"],
  })),
);

describe("the OpenAPI contract (T-046)", () => {
  it.each(operations)("$name declares a known permission", ({ permission }) => {
    expect(permission).toBeDefined();
    const keys = ["authenticated", "device-key", "public"].includes(permission!) ? [] : permission!.split(" | ");
    for (const key of keys) expect(PERMISSION_KEYS).toContain(key);
  });

  it("opens only the health checks to anyone (M9.4, A-311, A-315)", () => {
    expect(
      operations.filter((operation) => operation.permission === "public").map((operation) => operation.name),
    ).toEqual(["GET /api/v1/health", "GET /api/v1/health/ready"]);
  });
});
