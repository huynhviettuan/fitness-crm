import { describe, expect, it } from "vitest";
import { adjustmentFor, distributeAmount, ptPayoutInputSchema, ptPayoutListQuerySchema } from "./index.js";

describe("distributeAmount (D-027)", () => {
  it("gives every session the same share and the leftover dong to the first ones, adding up exactly", () => {
    expect(distributeAmount(1_000_000, 3)).toEqual([333_334, 333_333, 333_333]);
    expect(distributeAmount(1_000_000, 4)).toEqual([250_000, 250_000, 250_000, 250_000]);
    expect(distributeAmount(2, 5)).toEqual([1, 1, 0, 0, 0]);
    for (const [total, count] of [
      [7, 3],
      [123_456_789, 24],
      [0, 4],
      [99_999_999_999_999, 500],
    ] as const) {
      expect(distributeAmount(total, count).reduce((sum, part) => sum + part, 0)).toBe(total);
    }
  });

  it("has nothing to split across no sessions", () => {
    expect(distributeAmount(500, 0)).toEqual([]);
  });
});

describe("adjustmentFor", () => {
  it("takes back exactly what the session was paid", () => {
    expect(adjustmentFor(416_667)).toBe(-416_667);
    expect(adjustmentFor(0)).toBe(0);
  });
});

describe("the payout inputs", () => {
  const option = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";
  const valid = {
    trainerId: option,
    from: "01/10/2026",
    to: "31/10/2026",
    categoryId: option,
    methodId: option,
  };

  it("take a PT, a period, a category and a method, and no amount", () => {
    const parsed = ptPayoutInputSchema.parse({ ...valid, amount: "999" });
    expect(parsed).not.toHaveProperty("amount");
    expect(parsed.from.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("refuse a missing PT, a bad day and a missing category", () => {
    expect(ptPayoutInputSchema.safeParse({ ...valid, trainerId: "nope" }).success).toBe(false);
    expect(ptPayoutInputSchema.safeParse({ ...valid, to: "31/02/2026" }).success).toBe(false);
    expect(ptPayoutInputSchema.safeParse({ ...valid, categoryId: undefined }).success).toBe(false);
  });

  it("page the list and treat empty filters as not asked", () => {
    expect(ptPayoutListQuerySchema.parse({ trainerId: "", from: "" })).toMatchObject({ page: 1, pageSize: 20 });
    expect(ptPayoutListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
