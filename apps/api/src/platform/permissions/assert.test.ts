import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../errors/app-error.js";
import { assertCan } from "./assert.js";
import { hasBranch, inBranches } from "./scope.js";

const actor = { id: "u1", roleId: "r1", permissions: new Set(["customer.view"] as const) };

afterEach(() => vi.restoreAllMocks());

describe("assertCan (T-046)", () => {
  it("allows a permission the actor has", () => {
    expect(() => assertCan(actor, "customer.view")).not.toThrow();
  });

  it("throws FORBIDDEN and logs the denial otherwise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertCan(actor, "user.manage")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }) as unknown as AppError);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ event: "authz.denied", userId: "u1", permission: "user.manage" });
  });
});

describe("branch access (D-014)", () => {
  it("limits queries to granted branches", () => {
    expect(inBranches({ branches: ["b1", "b2"] })).toEqual({ branchId: { in: ["b1", "b2"] } });
    expect(hasBranch({ branches: ["b1"] }, "b2")).toBe(false);
  });

  it("does not limit users with every branch", () => {
    expect(inBranches({ branches: "ALL" })).toEqual({});
    expect(hasBranch({ branches: "ALL" }, "b2")).toBe(true);
  });
});
