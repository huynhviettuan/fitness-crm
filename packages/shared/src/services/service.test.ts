import { describe, expect, it } from "vitest";
import { quickPackagesInputSchema, serviceInputSchema, tiersInputSchema } from "./service.schema.js";
import {
  displayNameOf,
  endDateOf,
  findTier,
  tiersProblems,
  versionInForce,
  type PriceTierRow,
} from "./service.domain.js";

const tier = (minSessions: number, maxSessions: number | null, unitPrice = 500_000): PriceTierRow => ({
  minSessions,
  maxSessions,
  unitPrice,
  validityMonths: 2,
  validityDays: 0,
});
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("findTier", () => {
  const tiers = [tier(1, 11), tier(12, 23), tier(36, null)];

  it("finds the tier at both edges of its range", () => {
    expect(findTier(tiers, 1)).toBe(tiers[0]);
    expect(findTier(tiers, 11)).toBe(tiers[0]);
    expect(findTier(tiers, 12)).toBe(tiers[1]);
    expect(findTier(tiers, 23)).toBe(tiers[1]);
  });

  it("answers null in a gap and under the first tier", () => {
    expect(findTier(tiers, 24)).toBeNull();
    expect(findTier(tiers, 35)).toBeNull();
    expect(findTier([tier(5, 10)], 4)).toBeNull();
  });

  it("lets an open tier cover everything above it", () => {
    expect(findTier(tiers, 36)).toBe(tiers[2]);
    expect(findTier(tiers, 1000)).toBe(tiers[2]);
  });
});

describe("tiersProblems", () => {
  it("accepts tiers with a gap between them", () => {
    expect(tiersProblems([tier(1, 11), tier(24, 35)])).toEqual([]);
  });

  it("finds overlaps, inverted ranges, and an open tier that is not last", () => {
    expect(tiersProblems([tier(1, 12), tier(12, 24)])).toEqual(["tiersOverlap"]);
    expect(tiersProblems([tier(10, 5)])).toEqual(["tierRangeInverted"]);
    expect(tiersProblems([tier(1, null), tier(12, 24)])).toEqual(["openTierNotLast"]);
  });
});

describe("endDateOf", () => {
  it("counts the start day: one month from the 1st ends on the last day of the month (A-108)", () => {
    expect(endDateOf(day("2026-10-01"), 1, 0)).toEqual(day("2026-10-31"));
    expect(endDateOf(day("2026-10-15"), 2, 0)).toEqual(day("2026-12-14"));
  });

  it("adds days after the months", () => {
    expect(endDateOf(day("2026-10-01"), 0, 30)).toEqual(day("2026-10-30"));
    expect(endDateOf(day("2026-10-01"), 1, 10)).toEqual(day("2026-11-10"));
  });

  it("stops at the end of a shorter month", () => {
    expect(endDateOf(day("2026-01-31"), 1, 0)).toEqual(day("2026-02-27"));
    expect(endDateOf(day("2028-01-31"), 1, 0)).toEqual(day("2028-02-28"));
  });

  it("crosses a year", () => {
    expect(endDateOf(day("2026-11-20"), 3, 0)).toEqual(day("2027-02-19"));
  });
});

describe("displayNameOf and versionInForce", () => {
  it("builds the name from the service and the real count", () => {
    expect(displayNameOf("Hybrid Training", 30)).toBe("Hybrid Training 30 buổi");
  });

  it("takes the latest version that has started", () => {
    const versions = [
      { effectiveFrom: day("2026-01-01") },
      { effectiveFrom: day("2026-10-01") },
      { effectiveFrom: day("2027-01-01") },
    ];
    expect(versionInForce(versions, day("2026-09-30"))).toBe(versions[0]);
    expect(versionInForce(versions, day("2026-10-01"))).toBe(versions[1]);
    expect(versionInForce(versions, day("2026-12-31"))).toBe(versions[1]);
    expect(versionInForce(versions, day("2025-12-31"))).toBeNull();
  });
});

describe("serviceInputSchema", () => {
  const branchId = "b0000000-0000-4000-8000-000000000001";
  const base = { name: " Hybrid Training ", kind: "PT", branchIds: [branchId] };

  it("takes the minimum and fills the rest with empty values", () => {
    expect(serviceInputSchema.parse(base)).toMatchObject({
      name: "Hybrid Training",
      commissionRate: 100,
      isGroup: false,
      maxMembers: null,
      allowedFrom: null,
      activeFrom: null,
      active: true,
      notes: null,
    });
  });

  it("needs both ends of the allowed hours, in order, and a member limit for a group", () => {
    expect(serviceInputSchema.safeParse({ ...base, allowedFrom: "06:00" }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, allowedFrom: "10:00", allowedTo: "09:00" }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, allowedFrom: "06:00", allowedTo: "21:00" }).success).toBe(true);
    expect(serviceInputSchema.safeParse({ ...base, isGroup: true }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, isGroup: true, maxMembers: "4" }).success).toBe(true);
  });

  it("refuses no branch, a commission over 100, and a validity that ends before it starts", () => {
    expect(serviceInputSchema.safeParse({ ...base, branchIds: [] }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, commissionRate: "101" }).success).toBe(false);
    expect(serviceInputSchema.safeParse({ ...base, activeFrom: "10/10/2026", activeTo: "09/10/2026" }).success).toBe(
      false,
    );
  });
});

describe("tiersInputSchema and quickPackagesInputSchema", () => {
  it("reads a form's text and refuses overlapping tiers or a tier without validity", () => {
    const ok = tiersInputSchema.parse({
      effectiveFrom: "01/11/2026",
      tiers: [{ minSessions: "1", maxSessions: "11", unitPrice: "600.000", validityMonths: "2", validityDays: "0" }],
    });
    expect(ok.tiers[0]).toMatchObject({ minSessions: 1, maxSessions: 11, unitPrice: 600_000 });
    const row = { unitPrice: 1, validityMonths: 1, validityDays: 0 };
    expect(
      tiersInputSchema.safeParse({
        effectiveFrom: "01/11/2026",
        tiers: [
          { ...row, minSessions: 1, maxSessions: 12 },
          { ...row, minSessions: 12, maxSessions: 24 },
        ],
      }).success,
    ).toBe(false);
    expect(
      tiersInputSchema.safeParse({
        effectiveFrom: "01/11/2026",
        tiers: [{ ...row, validityMonths: 0, minSessions: 1, maxSessions: "" }],
      }).success,
    ).toBe(false);
  });

  it("sorts quick packages and refuses a repeated count", () => {
    expect(quickPackagesInputSchema.parse({ sessions: ["30", 12, 24] }).sessions).toEqual([12, 24, 30]);
    expect(quickPackagesInputSchema.safeParse({ sessions: [12, 12] }).success).toBe(false);
  });
});
