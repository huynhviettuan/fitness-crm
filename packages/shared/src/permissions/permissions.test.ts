import { describe, expect, it } from "vitest";
import { DATA_SCOPE_RESOURCES, MASKABLE_FIELDS, PERMISSION_GROUPS, PERMISSION_KEYS, isPermission } from "./permissions.js";

describe("permission catalog (D-017)", () => {
  it("lists every key once", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("names keys module.action", () => {
    for (const key of PERMISSION_KEYS) expect(key).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
  });

  it("keeps each group's keys together", () => {
    expect(PERMISSION_GROUPS.system).toEqual(["user.manage", "role.manage", "branch.manage"]);
  });

  it("recognizes catalog keys only", () => {
    expect(isPermission("contract.approve")).toBe(true);
    expect(isPermission("contract.manage")).toBe(false);
    expect(isPermission("")).toBe(false);
  });

  it("has data-scope resources and maskable fields", () => {
    expect(DATA_SCOPE_RESOURCES).toContain("customers");
    expect(MASKABLE_FIELDS).toContain("customer.phone");
  });
});
