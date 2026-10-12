import { describe, expect, it } from "vitest";
import { dueReminders, formatReminderHours, parseReminderHours } from "./reminder.domain.js";

const HOUR = 3_600_000;
const DEADLINE = new Date("2030-03-02T10:00:00Z");
const before = (hours: number) => new Date(DEADLINE.getTime() - hours * HOUR);

describe("parseReminderHours (D-056)", () => {
  it("reads hours, longest first, with decimals and either separator", () => {
    expect(parseReminderHours("1, 24, 3")).toEqual({ minutes: [1440, 180, 60] });
    expect(parseReminderHours("24; 0.5")).toEqual({ minutes: [1440, 30] });
    expect(parseReminderHours("1,5")).toEqual({ minutes: [300, 60] });
    expect(parseReminderHours("1.5")).toEqual({ minutes: [90] });
    expect(parseReminderHours("")).toEqual({ minutes: [] });
    expect(parseReminderHours(" , ")).toEqual({ minutes: [] });
  });

  it("refuses words, negatives, repeats, nothing to count, and a point past 30 days", () => {
    for (const bad of ["abc", "-1", "3, 3", "0", "0.001", "721", "1h", "1..5", "1:30"]) {
      expect(parseReminderHours(bad), bad).toEqual({ error: "invalidReminders" });
    }
    expect(parseReminderHours("720")).toEqual({ minutes: [43200] });
  });

  it("refuses more than ten points", () => {
    expect(parseReminderHours("1,2,3,4,5,6,7,8,9,10,11")).toEqual({ error: "tooManyReminders" });
    expect(parseReminderHours("1,2,3,4,5,6,7,8,9,10")).toMatchObject({ minutes: expect.any(Array) });
  });
});

describe("formatReminderHours", () => {
  it("writes minutes back as hours", () => {
    expect(formatReminderHours([1440, 180, 30])).toBe("24, 3, 0.5");
    expect(formatReminderHours([])).toBe("");
  });
});

describe("dueReminders (D-056)", () => {
  const points = [1440, 180, 60];

  it("tells nothing before the first point", () => {
    expect(dueReminders(points, new Set(), DEADLINE, before(25))).toEqual({ tell: null, mark: [] });
  });

  it("tells each point as it comes, once", () => {
    expect(dueReminders(points, new Set(), DEADLINE, before(24))).toEqual({ tell: 1440, mark: [1440] });
    expect(dueReminders(points, new Set([1440]), DEADLINE, before(23))).toEqual({ tell: null, mark: [] });
    expect(dueReminders(points, new Set([1440]), DEADLINE, before(3))).toEqual({ tell: 180, mark: [180] });
    expect(dueReminders(points, new Set([1440, 180]), DEADLINE, before(1))).toEqual({ tell: 60, mark: [60] });
    expect(dueReminders(points, new Set([1440, 180, 60]), DEADLINE, before(0.5))).toEqual({ tell: null, mark: [] });
  });

  it("tells only the tightest point when several have come at once, and marks them all", () => {
    expect(dueReminders(points, new Set(), DEADLINE, before(2))).toEqual({ tell: 180, mark: [1440, 180] });
    expect(dueReminders(points, new Set(), DEADLINE, before(0.5))).toEqual({ tell: 60, mark: [1440, 180, 60] });
  });

  it("tells nothing at or after the deadline: the overdue notice is its own", () => {
    expect(dueReminders(points, new Set(), DEADLINE, DEADLINE)).toEqual({ tell: null, mark: [] });
    expect(dueReminders(points, new Set(), DEADLINE, before(-1))).toEqual({ tell: null, mark: [] });
  });

  it("has nothing to tell when the list is empty", () => {
    expect(dueReminders([], new Set(), DEADLINE, before(1))).toEqual({ tell: null, mark: [] });
  });
});
