import { describe, expect, it } from "vitest";
import { isWithinAccessWindows } from "./access-hours.js";

const TZ = "Asia/Ho_Chi_Minh";
// Monday 12 October 2026, 08:00 in Ho Chi Minh City (01:00 UTC).
const mondayEight = new Date("2026-10-12T01:00:00Z");
const officeHours = { weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "17:30" };

describe("isWithinAccessWindows (D-017)", () => {
  it("allows any time when the user has no windows", () => {
    expect(isWithinAccessWindows([], mondayEight, TZ)).toBe(true);
  });

  it("uses the gym's clock and includes the start minute", () => {
    expect(isWithinAccessWindows([officeHours], mondayEight, TZ)).toBe(true);
    expect(isWithinAccessWindows([officeHours], new Date("2026-10-12T00:59:00Z"), TZ)).toBe(false);
  });

  it("excludes the end minute", () => {
    expect(isWithinAccessWindows([officeHours], new Date("2026-10-12T10:29:00Z"), TZ)).toBe(true);
    expect(isWithinAccessWindows([officeHours], new Date("2026-10-12T10:30:00Z"), TZ)).toBe(false);
  });

  it("checks the weekday in the gym timezone, with Sunday as 7", () => {
    // 23:30 UTC on Saturday is 06:30 on Sunday in Ho Chi Minh City.
    const sundayMorning = new Date("2026-10-17T23:30:00Z");
    expect(isWithinAccessWindows([officeHours], sundayMorning, TZ)).toBe(false);
    expect(isWithinAccessWindows([{ weekdays: [7], startTime: "06:00", endTime: "12:00" }], sundayMorning, TZ)).toBe(true);
  });

  it("allows a time inside any of several windows", () => {
    const evening = { weekdays: [1], startTime: "18:00", endTime: "22:00" };
    expect(isWithinAccessWindows([evening, officeHours], mondayEight, TZ)).toBe(true);
  });
});
