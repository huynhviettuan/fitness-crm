import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canMarkAttendance,
  canRemoveEnrollment,
  hasSessionForEnrollment,
  isTaught,
  occurrenceDays,
  seatsLeft,
} from "./class.domain.js";
import { classInputSchema, markAttendanceSchema } from "./class.schema.js";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("occurrenceDays (A-161)", () => {
  it("lists the days a weekly class runs, Monday to Saturday for Group Training", () => {
    // 12 October 2026 is a Monday.
    const days = occurrenceDays([1, 2, 3, 4, 5, 6], day("2026-10-12"), 14).map((d) => d.toISOString().slice(0, 10));
    expect(days).toHaveLength(12);
    expect(days).not.toContain("2026-10-18");
    expect(days).not.toContain("2026-10-25");
    expect(days[0]).toBe("2026-10-12");
  });

  it("starts from any day, includes it when it fits, and handles one weekday", () => {
    expect(occurrenceDays([7], day("2026-10-18"), 1)).toEqual([day("2026-10-18")]);
    expect(occurrenceDays([1], day("2026-10-13"), 7).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-19"]);
    expect(occurrenceDays([1], day("2026-10-13"), 0)).toEqual([]);
  });
});

describe("seats and sessions (BR-411)", () => {
  it("counts the seats left, never below zero", () => {
    expect(seatsLeft(20, 5)).toBe(15);
    expect(seatsLeft(3, 3)).toBe(0);
    expect(seatsLeft(3, 4)).toBe(0);
  });

  it("promises a contract no more enrollments than it has sessions left", () => {
    expect(hasSessionForEnrollment(3, 2)).toBe(true);
    expect(hasSessionForEnrollment(3, 3)).toBe(false);
    expect(hasSessionForEnrollment(0, 0)).toBe(false);
  });

  it("marks and removes only an enrollment not yet marked, and counts a class taught when someone was present", () => {
    expect(["ENROLLED", "PRESENT", "ABSENT"].filter(canMarkAttendance)).toEqual(["ENROLLED"]);
    expect(["ENROLLED", "PRESENT", "ABSENT"].filter(canRemoveEnrollment)).toEqual(["ENROLLED"]);
    expect(isTaught(["ABSENT", "PRESENT"])).toBe(true);
    expect(isTaught(["ENROLLED", "ABSENT"])).toBe(false);
    expect(isTaught([])).toBe(false);
  });
});

describe("classInputSchema", () => {
  const valid = {
    name: "Group Training",
    branchId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
    coachId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    capacity: "20",
    weekdays: ["6", "1", "1"],
    startTime: "9:00",
    endTime: "10:00",
  };
  const errors = (input: unknown) => {
    const result = classInputSchema.safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  };

  it("sorts and de-duplicates the weekdays and normalizes the times", () => {
    expect(classInputSchema.parse(valid)).toMatchObject({ weekdays: [1, 6], startTime: "09:00", capacity: 20 });
  });

  it("refuses an empty or foreign weekday list, a zero capacity, and an end before the start", () => {
    expect(errors({ ...valid, weekdays: [] })).toHaveProperty("weekdays");
    expect(errors({ ...valid, weekdays: [8] })).toHaveProperty("weekdays");
    expect(errors({ ...valid, capacity: 0 })).toHaveProperty("capacity");
    expect(errors({ ...valid, endTime: "08:00" })).toHaveProperty("endTime");
  });
});

describe("markAttendanceSchema", () => {
  it("takes present or absent only", () => {
    expect(markAttendanceSchema.safeParse({ status: "PRESENT" }).success).toBe(true);
    expect(markAttendanceSchema.safeParse({ status: "ENROLLED" }).success).toBe(false);
  });
});
