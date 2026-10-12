import { describe, expect, it } from "vitest";
import { coversSlot, isoWeekday, overlappingShift, workingIntervals } from "./employee.domain.js";
import { dayOffInputSchema, employeeInputSchema, formatEmployeeCode, shiftsInputSchema } from "./employee.schema.js";

const fieldErrors = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]));

describe("formatEmployeeCode (D-038)", () => {
  it("pads to the prefix + 3 digits and keeps growing past 999", () => {
    expect(formatEmployeeCode("NV", BigInt(1))).toBe("NV001");
    expect(formatEmployeeCode("PT", 1000)).toBe("PT1000");
  });
});

describe("employeeInputSchema", () => {
  it("defaults to an active non-trainer with no login, and stores empty fields as null", () => {
    expect(employeeInputSchema.parse({ fullName: " Trần Minh " })).toEqual({
      fullName: "Trần Minh",
      birthDate: null,
      gender: null,
      phone: null,
      email: null,
      departmentId: null,
      departmentNote: null,
      team: null,
      titleId: null,
      titleNote: null,
      managerId: null,
      status: "ACTIVE",
      isTrainer: false,
      userId: null,
    });
  });

  it("normalizes phone and email and parses the birth date", () => {
    const parsed = employeeInputSchema.parse({
      fullName: "A",
      phone: "090 123.4567",
      email: " Minh@Flow.VN ",
      birthDate: "02/03/1995",
    });
    expect(parsed).toMatchObject({
      phone: "0901234567",
      email: "minh@flow.vn",
      birthDate: new Date(Date.UTC(1995, 2, 2)),
    });
  });

  it("rejects a bad phone, email, gender, and a birth date in the future", () => {
    const result = employeeInputSchema.safeParse({
      fullName: "A",
      phone: "12",
      email: "x@",
      gender: "X",
      birthDate: "01/01/2999",
    });
    expect(fieldErrors(result)).toEqual({
      phone: "invalidPhone",
      email: "invalidEmail",
      gender: "invalidChoice",
      birthDate: "invalidDate",
    });
  });

  it("never accepts an employee code from the client", () => {
    expect(employeeInputSchema.parse({ fullName: "A", employeeCode: "NV999" })).not.toHaveProperty("employeeCode");
  });
});

describe("working schedule (D-030)", () => {
  it("accepts half-hour shifts ending as late as 24:00", () => {
    expect(shiftsInputSchema.safeParse({ shifts: [{ weekday: 1, start: "00:00", end: "24:00" }] }).success).toBe(true);
  });

  it("rejects times off the 30-minute cells, an end not after the start, and a bad weekday", () => {
    expect(
      fieldErrors(shiftsInputSchema.safeParse({ shifts: [{ weekday: 1, start: "08:15", end: "12:00" }] })),
    ).toEqual({
      "shifts.0.start": "notOnHalfHour",
    });
    expect(
      fieldErrors(shiftsInputSchema.safeParse({ shifts: [{ weekday: 2, start: "12:00", end: "12:00" }] })),
    ).toEqual({
      "shifts.0.end": "endTimeNotAfterStart",
    });
    expect(
      fieldErrors(shiftsInputSchema.safeParse({ shifts: [{ weekday: 8, start: "08:00", end: "12:00" }] })),
    ).toEqual({
      "shifts.0.weekday": "invalidChoice",
    });
    expect(
      fieldErrors(shiftsInputSchema.safeParse({ shifts: [{ weekday: 1, start: "24:00", end: "24:00" }] })),
    ).toMatchObject({
      "shifts.0.start": "invalidTime",
    });
  });

  it("rejects overlapping shifts on one day, but not touching ones or other days", () => {
    const shifts = [
      { weekday: 1, start: "08:00", end: "12:00" },
      { weekday: 1, start: "12:00", end: "14:00" },
      { weekday: 2, start: "09:00", end: "13:00" },
      { weekday: 1, start: "11:30", end: "13:00" },
    ];
    expect(overlappingShift(shifts.slice(0, 3))).toBe(-1);
    expect(overlappingShift(shifts)).toBe(3);
    expect(fieldErrors(shiftsInputSchema.safeParse({ shifts }))).toEqual({ "shifts.3.start": "shiftsOverlap" });
  });

  it("joins touching shifts into working hours and covers slots inside one stretch only", () => {
    const shifts = [
      { weekday: 3, start: "12:00", end: "14:00" },
      { weekday: 3, start: "08:00", end: "12:00" },
      { weekday: 3, start: "17:00", end: "21:00" },
    ];
    const hours = workingIntervals(shifts, 3);
    expect(hours).toEqual([
      { start: 480, end: 840 },
      { start: 1020, end: 1260 },
    ]);
    expect(coversSlot(hours, 690, 750)).toBe(true); // 11:30–12:30, across the joined shifts
    expect(coversSlot(hours, 810, 1050)).toBe(false); // 13:30–17:30, through the break
    expect(coversSlot(hours, 1200, 1260)).toBe(true); // 20:00–21:00, up to the end
    expect(workingIntervals(shifts, 4)).toEqual([]);
    expect(workingIntervals(shifts, 3, true)).toEqual([]);
  });

  it("numbers weekdays from Monday 1 to Sunday 7", () => {
    expect(isoWeekday(new Date(Date.UTC(2026, 9, 12)))).toBe(1); // Monday 12/10/2026
    expect(isoWeekday(new Date(Date.UTC(2026, 9, 11)))).toBe(7); // Sunday
  });

  it("takes a day off with an optional note", () => {
    expect(dayOffInputSchema.parse({ date: "20/10/2026" })).toEqual({
      date: new Date(Date.UTC(2026, 9, 20)),
      note: null,
    });
    expect(fieldErrors(dayOffInputSchema.safeParse({ date: "" }))).toEqual({ date: "required" });
  });
});
