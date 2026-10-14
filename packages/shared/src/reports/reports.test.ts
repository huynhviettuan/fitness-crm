import { describe, expect, it } from "vitest";
import {
  allocationPerSession,
  allocationValueOf,
  bookingReportQuerySchema,
  entitledSessions,
  ptAllocation,
  ptRevenueQuerySchema,
  startsInShift,
} from "./index.js";

describe("the PT allocation (D-032, A-026)", () => {
  it("shares the value after discounts, excluding VAT, across the sessions bought and the bonus", () => {
    // 11,000,000 with 10% VAT is 10,000,000 of allocation; 20 + 4 bonus sessions.
    const allocationValue = allocationValueOf(11_000_000, 1_000_000);
    const sessions = entitledSessions(20, 4);
    expect(allocationValue).toBe(10_000_000);
    expect(sessions).toBe(24);
    expect(allocationPerSession(allocationValue, sessions)).toBe(416_667);
  });

  it("is credited × allocation per session × commission × timesheet, rounded once", () => {
    const base = { allocationValue: 10_000_000, sessions: 24, commissionRate: 100, timesheetRate: 100 };
    expect(ptAllocation({ ...base, credited: 0 })).toBe(0);
    expect(ptAllocation({ ...base, credited: 1 })).toBe(416_667);
    // 3 sessions are 1,250,000 exactly, not 3 × the rounded 416,667 = 1,250,001.
    expect(ptAllocation({ ...base, credited: 3 })).toBe(1_250_000);
    expect(ptAllocation({ ...base, credited: 24 })).toBe(10_000_000);
  });

  it("applies the commission rate and the timesheet rate as percents, with two decimals", () => {
    const base = { credited: 6, allocationValue: 12_000_000, sessions: 12 };
    expect(ptAllocation({ ...base, commissionRate: 50, timesheetRate: 100 })).toBe(3_000_000);
    expect(ptAllocation({ ...base, commissionRate: 100, timesheetRate: 80 })).toBe(4_800_000);
    expect(ptAllocation({ ...base, commissionRate: 12.5, timesheetRate: 90 })).toBe(675_000);
    expect(ptAllocation({ ...base, commissionRate: 0, timesheetRate: 100 })).toBe(0);
  });

  it("rounds half up to the dong", () => {
    // 1 × 1,000,001 ÷ 2 = 500,000.5
    expect(
      ptAllocation({ credited: 1, allocationValue: 1_000_001, sessions: 2, commissionRate: 100, timesheetRate: 100 }),
    ).toBe(500_001);
  });

  it("stays exact for a value and two rates that a floating-point number could not hold", () => {
    expect(
      ptAllocation({
        credited: 500,
        allocationValue: 99_999_999_999_999,
        sessions: 500,
        commissionRate: 100,
        timesheetRate: 100,
      }),
    ).toBe(99_999_999_999_999);
  });

  it("is nothing for a contract without sessions, or without value", () => {
    expect(
      ptAllocation({ credited: 2, allocationValue: 5_000_000, sessions: 0, commissionRate: 100, timesheetRate: 100 }),
    ).toBe(0);
    expect(
      ptAllocation({ credited: 2, allocationValue: 0, sessions: 10, commissionRate: 100, timesheetRate: 100 }),
    ).toBe(0);
    expect(allocationValueOf(500_000, 600_000)).toBe(0);
    expect(allocationPerSession(1_000_000, 0)).toBe(0);
  });
});

describe("a session in or outside the shift (D-058)", () => {
  const shifts = [
    { weekday: 1, startMinute: 8 * 60, endMinute: 12 * 60 },
    { weekday: 1, startMinute: 14 * 60, endMinute: 20 * 60 },
  ];

  it("is inside from the first minute of a shift up to, not including, its last", () => {
    expect(startsInShift(shifts, 1, 8 * 60)).toBe(true);
    expect(startsInShift(shifts, 1, 12 * 60 - 1)).toBe(true);
    expect(startsInShift(shifts, 1, 12 * 60)).toBe(false);
    expect(startsInShift(shifts, 1, 14 * 60)).toBe(true);
  });

  it("is outside on another weekday, before the first shift, and on a day off", () => {
    expect(startsInShift(shifts, 2, 9 * 60)).toBe(false);
    expect(startsInShift(shifts, 1, 7 * 60)).toBe(false);
    expect(startsInShift(shifts, 1, 9 * 60, true)).toBe(false);
    expect(startsInShift([], 1, 9 * 60)).toBe(false);
  });
});

describe("the report queries", () => {
  it("take a period, a branch, and a PT, and treat empty form fields as not asked", () => {
    const parsed = ptRevenueQuerySchema.parse({ from: "01/10/2026", to: "31/10/2026", branchId: "", trainerId: "" });
    expect(parsed.branchId).toBeUndefined();
    expect(parsed.trainerId).toBeUndefined();
    expect(parsed.from?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(ptRevenueQuerySchema.safeParse({ trainerId: "nope" }).success).toBe(false);
  });

  it("page the booking report and refuse an unknown type", () => {
    expect(bookingReportQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(bookingReportQuerySchema.parse({ type: "BURN_SHOW", status: "" })).toMatchObject({ type: "BURN_SHOW" });
    expect(bookingReportQuerySchema.safeParse({ type: "CLASS" }).success).toBe(false);
    expect(bookingReportQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(bookingReportQuerySchema.safeParse({ status: "x".repeat(41) }).success).toBe(false);
  });
});
