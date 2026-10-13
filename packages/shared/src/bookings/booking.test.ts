import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BOOKING_STATUSES,
  canCancelBooking,
  canCheckIn,
  canComplete,
  canDeleteBooking,
  canMarkNoShow,
  canReschedule,
  hasSessionForNewBooking,
  isWithinContractPeriod,
  type BookingFacts,
} from "./booking.domain.js";
import { bookingInputSchema, rescheduleSchema, sessionStatusInputSchema } from "./booking.schema.js";

describe("allowed actions (A-006, D-025, D-026)", () => {
  const facts = (status: string, checkedIn: boolean) => ({ status, checkedIn });
  const cases = BOOKING_STATUSES.flatMap((status) => [facts(status, false), facts(status, true)]);
  const allowed = (rule: (facts: BookingFacts) => boolean) =>
    cases.filter(rule).map(({ status, checkedIn }) => `${status}${checkedIn ? "+in" : ""}`);

  it("matches the state machine: check-in is a fact on a Booked session, not a status", () => {
    expect(allowed(canReschedule)).toEqual(["BOOKED"]);
    expect(allowed(canCheckIn)).toEqual(["BOOKED"]);
    // D-026: no separate check-in step before Đã tập.
    expect(allowed(canComplete)).toEqual(["BOOKED", "BOOKED+in"]);
    expect(allowed(canDeleteBooking)).toEqual(["BOOKED"]);
    expect(allowed(canCancelBooking)).toEqual(["BOOKED", "BOOKED+in"]);
    expect(allowed(canMarkNoShow)).toEqual(["BOOKED"]);
  });
});

describe("isWithinContractPeriod (BR-012, OQ-001 interim)", () => {
  const contract = { startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z") };

  it("includes the first and last day", () => {
    expect(isWithinContractPeriod(new Date("2026-10-01T00:00:00Z"), contract)).toBe(true);
    expect(isWithinContractPeriod(new Date("2026-10-31T00:00:00Z"), contract)).toBe(true);
    expect(isWithinContractPeriod(new Date("2026-09-30T00:00:00Z"), contract)).toBe(false);
    expect(isWithinContractPeriod(new Date("2026-11-01T00:00:00Z"), contract)).toBe(false);
  });
});

describe("hasSessionForNewBooking (OQ-008 interim)", () => {
  it("needs a remaining session not promised to an open booking", () => {
    expect(hasSessionForNewBooking(24, 0)).toBe(true);
    expect(hasSessionForNewBooking(2, 1)).toBe(true);
    expect(hasSessionForNewBooking(2, 2)).toBe(false);
    expect(hasSessionForNewBooking(0, 0)).toBe(false);
  });
});

describe("bookingInputSchema", () => {
  const ids = {
    customerId: "8f0c2b4e-6a59-4d7e-9a43-0b6f1d2c3e4a",
    contractId: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
    trainerId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  };
  const fieldErrors = (input: unknown) => {
    const result = bookingInputSchema.safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  };

  it("parses the day and normalizes times to HH:mm", () => {
    expect(bookingInputSchema.parse({ ...ids, date: "15/10/2026", startTime: "8:00", endTime: "09:30" })).toEqual({
      ...ids,
      date: new Date("2026-10-15T00:00:00Z"),
      startTime: "08:00",
      endTime: "09:30",
    });
  });

  it("names the field that is wrong, with an i18n key", () => {
    expect(fieldErrors({ ...ids, customerId: "", date: "15/10/2026", startTime: "24:00", endTime: "9" })).toEqual({
      customerId: ["required"],
      startTime: ["invalidTime"],
      endTime: ["invalidTime"],
    });
    expect(fieldErrors({ ...ids, trainerId: "not-a-uuid", date: "", startTime: "18:00", endTime: "19:00" })).toEqual({
      trainerId: ["invalidChoice"],
      date: ["required"],
    });
  });

  it("refuses an end time that is not after the start (BR-011)", () => {
    for (const endTime of ["18:00", "17:59"]) {
      expect(fieldErrors({ ...ids, date: "15/10/2026", startTime: "18:00", endTime })).toEqual({
        endTime: ["endTimeNotAfterStart"],
      });
    }
  });

  it("never accepts a status or session facts from the client", () => {
    const parsed = bookingInputSchema.parse({
      ...ids,
      date: "15/10/2026",
      startTime: "18:00",
      endTime: "19:00",
      status: "COMPLETED",
    });
    expect(parsed).not.toHaveProperty("status");
    expect(
      rescheduleSchema.parse({ ...ids, date: "15/10/2026", startTime: "18:00", endTime: "19:00" }),
    ).not.toHaveProperty("contractId");
  });
});

describe("sessionStatusInputSchema (D-025)", () => {
  const input = {
    labelVi: "Đã tập",
    labelEn: "Trained",
    consumes: true,
    creditsPt: true,
    locksOnSet: true,
    color: "info",
  };

  it("takes labels, flags, and one of the design colors", () => {
    expect(sessionStatusInputSchema.safeParse(input).success).toBe(true);
    expect(sessionStatusInputSchema.safeParse({ ...input, color: "#ff0000" }).success).toBe(false);
    expect(sessionStatusInputSchema.safeParse({ ...input, labelVi: " " }).success).toBe(false);
    expect(sessionStatusInputSchema.safeParse({ ...input, consumes: "yes" }).success).toBe(false);
  });
});
