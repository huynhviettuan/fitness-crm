import { describe, expect, it } from "vitest";
import { z } from "zod";
import { calendarDateInTimeZone } from "../validation/index.js";
import { canActivate, canCancel, contractFigures, effectiveStatus, formatContractCode, isEditable } from "./contract.domain.js";
import { contractInputSchema } from "./contract.schema.js";

const GYM_TZ = "Asia/Ho_Chi_Minh";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("formatContractCode (A-003)", () => {
  it("pads to HD + 6 digits", () => {
    expect(formatContractCode(BigInt(1))).toBe("HD000001");
    expect(formatContractCode(1_000_000)).toBe("HD1000000");
  });
});

describe("effective status (T-018, INT-008)", () => {
  const endingToday = { status: "ACTIVE" as const, endDate: day("2026-10-10") };

  it("is still ACTIVE at 23:59 on the end date in the gym timezone", () => {
    const today = calendarDateInTimeZone(GYM_TZ, new Date("2026-10-10T16:59:00Z")); // 23:59 UTC+7
    expect(effectiveStatus(endingToday, today)).toBe("ACTIVE");
  });

  it("becomes EXPIRED at 00:00 the next day in the gym timezone, with no job running", () => {
    const today = calendarDateInTimeZone(GYM_TZ, new Date("2026-10-10T17:00:00Z")); // 00:00 next day UTC+7
    expect(effectiveStatus(endingToday, today)).toBe("EXPIRED");
  });

  it("never turns DRAFT or CANCELLED into EXPIRED", () => {
    const later = day("2030-01-01");
    expect(effectiveStatus({ status: "DRAFT", endDate: day("2026-01-01") }, later)).toBe("DRAFT");
    expect(effectiveStatus({ status: "CANCELLED", endDate: day("2026-01-01") }, later)).toBe("CANCELLED");
  });
});

describe("allowed actions by status", () => {
  it.each([
    ["DRAFT", { edit: true, activate: true, cancel: true }],
    ["ACTIVE", { edit: false, activate: false, cancel: true }],
    ["EXPIRED", { edit: false, activate: false, cancel: false }],
    ["CANCELLED", { edit: false, activate: false, cancel: false }],
  ] as const)("%s", (status, expected) => {
    expect({ edit: isEditable(status), activate: canActivate(status), cancel: canCancel(status) }).toEqual(expected);
  });
});

describe("contractFigures (T-012, BR-013, D-011)", () => {
  it("derives remaining sessions, paid amount, and debt", () => {
    expect(
      contractFigures({
        totalSessions: 24,
        openingSessionsUsed: 0,
        completedSessions: 9,
        contractValue: 12_000_000,
        openingPaidAmount: 0,
        confirmedPaidAmount: 8_000_000,
      }),
    ).toMatchObject({ remainingSessions: 15, paidAmount: 8_000_000, debt: 4_000_000 });
  });

  it("counts opening balances of an imported contract", () => {
    expect(
      contractFigures({
        totalSessions: 24,
        openingSessionsUsed: 8,
        completedSessions: 2,
        contractValue: 12_000_000,
        openingPaidAmount: 5_000_000,
        confirmedPaidAmount: 3_000_000,
      }),
    ).toMatchObject({ remainingSessions: 14, paidAmount: 8_000_000, debt: 4_000_000 });
  });
});

describe("contractInputSchema", () => {
  const valid = { packageName: "PT 24 buổi", contractValue: "12.000.000", totalSessions: "24", startDate: "01/10/2026", endDate: "31/03/2027" };
  const errors = (input: unknown) => {
    const result = contractInputSchema.safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  };

  it("parses form text into typed values", () => {
    expect(contractInputSchema.parse(valid)).toEqual({
      packageName: "PT 24 buổi",
      contractValue: 12_000_000,
      totalSessions: 24,
      startDate: day("2026-10-01"),
      endDate: day("2027-03-31"),
    });
  });

  it.each(["12.000.000", "12,000,000", "12 000 000", "12000000", 12_000_000])("accepts the amount %j", (contractValue) => {
    expect(contractInputSchema.parse({ ...valid, contractValue }).contractValue).toBe(12_000_000);
  });

  it.each(["12.5", "12,50", "-5", "1.2.3", "abc", 12.5, "999999999999999"])("rejects the amount %j", (contractValue) => {
    expect(errors({ ...valid, contractValue })).toEqual({ contractValue: ["invalidAmount"] });
  });

  it.each(["0", "1001", "2.5", "x"])("rejects %j sessions", (totalSessions) => {
    expect(errors({ ...valid, totalSessions })).toEqual({ totalSessions: ["invalidNumber"] });
  });

  it("rejects an end date before the start date, but allows the same day", () => {
    expect(errors({ ...valid, endDate: "30/09/2026" })).toEqual({ endDate: ["endBeforeStart"] });
    expect(contractInputSchema.safeParse({ ...valid, endDate: "01/10/2026" }).success).toBe(true);
  });

  it("never accepts client-set code, status, or opening balances (BR-001, D-011)", () => {
    const parsed = contractInputSchema.parse({
      ...valid,
      contractCode: "HD999999",
      status: "ACTIVE",
      openingSessionsUsed: 20,
      openingPaidAmount: 12_000_000,
    });
    expect(Object.keys(parsed).sort()).toEqual(["contractValue", "endDate", "packageName", "startDate", "totalSessions"]);
  });
});
