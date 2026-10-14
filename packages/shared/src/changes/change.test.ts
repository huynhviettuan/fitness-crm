import { describe, expect, it } from "vitest";
import {
  VOUCHER_ACTIONS,
  VOUCHER_KINDS,
  canChangeContract,
  endDateAfterHold,
  holdDays,
  holdInputSchema,
  isInRanges,
  rangesOverlap,
  renewalInputSchema,
  renewalPeriod,
  voucherListQuerySchema,
} from "./index.js";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const id = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";

describe("the kinds of voucher (brief §5.6, D-024)", () => {
  it("has an approval action for each kind, so Admin switches each on or off", () => {
    expect(Object.keys(VOUCHER_ACTIONS).sort()).toEqual([...VOUCHER_KINDS].sort());
    expect(new Set(Object.values(VOUCHER_ACTIONS)).size).toBe(VOUCHER_KINDS.length);
  });

  it("changes only an approved and running contract", () => {
    expect(canChangeContract("ACTIVE")).toBe(true);
    for (const status of ["DRAFT", "REJECTED", "CANCELLED", "FROZEN", "EXPIRED"]) {
      expect(canChangeContract(status), status).toBe(false);
    }
  });
});

describe("holds (brief §5.6)", () => {
  it("counts both ends of the days held, and moves the end date by them", () => {
    expect(holdDays(day("2026-11-10"), day("2026-11-12"))).toBe(3);
    expect(holdDays(day("2026-11-10"), day("2026-11-10"))).toBe(1);
    expect(endDateAfterHold(day("2027-01-04"), 10)).toEqual(day("2027-01-14"));
  });

  it("sees overlapping ranges, also when they only touch, and the day inside one", () => {
    const a = { from: day("2026-11-10"), to: day("2026-11-20") };
    expect(rangesOverlap(a, { from: day("2026-11-20"), to: day("2026-11-25") })).toBe(true);
    expect(rangesOverlap(a, { from: day("2026-11-21"), to: day("2026-11-25") })).toBe(false);
    expect(rangesOverlap(a, { from: day("2026-11-01"), to: day("2026-11-30") })).toBe(true);
    expect(isInRanges([a], day("2026-11-10"))).toBe(true);
    expect(isInRanges([a], day("2026-11-20"))).toBe(true);
    expect(isInRanges([a], day("2026-11-21"))).toBe(false);
    expect(isInRanges([], day("2026-11-10"))).toBe(false);
  });

  it("takes a hold with its days and refuses an end before the start", () => {
    const base = { contractId: id, fromDate: "10/11/2026", toDate: "20/11/2026" };
    expect(holdInputSchema.safeParse(base).success).toBe(true);
    expect(holdInputSchema.safeParse({ ...base, toDate: "09/11/2026" }).error?.issues[0]?.message).toBe(
      "endBeforeStart",
    );
    expect(holdInputSchema.safeParse({ ...base, toDate: "" }).success).toBe(false);
    expect(holdInputSchema.safeParse({ ...base, note: "a\u0007b" }).success).toBe(false);
  });
});

describe("renewals (brief §5.6, A-220)", () => {
  it("starts the day after the contract ends, or today when it ended, and runs the months and days", () => {
    const ending = renewalPeriod({
      endDate: day("2026-12-31"),
      today: day("2026-11-01"),
      from: null,
      months: 1,
      days: 0,
    });
    expect(ending.from).toEqual(day("2027-01-01"));
    expect(ending.to).toEqual(day("2027-01-31"));
    expect(ending.newEndDate).toEqual(day("2027-01-31"));
    const ended = renewalPeriod({
      endDate: day("2026-09-30"),
      today: day("2026-11-05"),
      from: null,
      months: 0,
      days: 10,
    });
    expect(ended.from).toEqual(day("2026-11-05"));
    expect(ended.to).toEqual(day("2026-11-14"));
  });

  it("keeps the later end date, and adds no dates when only sessions are added", () => {
    const earlier = renewalPeriod({
      endDate: day("2027-06-30"),
      today: day("2026-11-01"),
      from: day("2026-11-10"),
      months: 1,
      days: 0,
    });
    expect(earlier.to).toEqual(day("2026-12-09"));
    expect(earlier.newEndDate).toEqual(day("2027-06-30"));
    const sessions = renewalPeriod({
      endDate: day("2027-06-30"),
      today: day("2026-11-01"),
      from: null,
      months: 0,
      days: 0,
    });
    expect(sessions.to).toBeNull();
    expect(sessions.newEndDate).toEqual(day("2027-06-30"));
  });

  it("needs something to add, takes numbers typed as text, and amounts with separators", () => {
    expect(renewalInputSchema.safeParse({ contractId: id }).error?.issues[0]?.message).toBe("nothingToAdd");
    const ok = renewalInputSchema.parse({ contractId: id, months: "1", days: "", sessions: "12", amount: "3.000.000" });
    expect(ok).toMatchObject({ months: 1, days: 0, sessions: 12, amount: 3_000_000, note: null });
    for (const bad of [{ months: -1 }, { sessions: 1001 }, { days: "x" }, { sessions: 1.5 }]) {
      expect(renewalInputSchema.safeParse({ contractId: id, sessions: 1, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
    expect(renewalInputSchema.safeParse({ contractId: id, sessions: 1, fromDate: "99/99/2026" }).success).toBe(false);
  });

  it("lists with filters and a paged query", () => {
    expect(voucherListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(voucherListQuerySchema.parse({ kind: "HOLD", status: "" }).kind).toBe("HOLD");
    expect(voucherListQuerySchema.safeParse({ kind: "OTHER" }).success).toBe(false);
    expect(voucherListQuerySchema.safeParse({ contractId: "nope" }).success).toBe(false);
  });
});
