import { describe, expect, it } from "vitest";
import { z } from "zod";
import { calendarDateInTimeZone } from "../validation/index.js";
import {
  canActivate,
  canCancel,
  canUnapprove,
  customerContractStatus,
  paymentStatusOf,
  contractEndDate,
  contractFigures,
  effectiveStatus,
  entitledSessions,
  formatContractCode,
  isEditable,
  ptSharesRequired,
  sharesProblems,
} from "./contract.domain.js";
import { contractInputSchema } from "./contract.schema.js";

const GYM_TZ = "Asia/Ho_Chi_Minh";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("formatContractCode (D-038)", () => {
  it("pads to the prefix + 6 digits", () => {
    expect(formatContractCode("HD", BigInt(1))).toBe("HD000001");
    expect(formatContractCode("HP", 1_000_000)).toBe("HP1000000");
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
    ["DRAFT", { edit: true, activate: true, cancel: true, unapprove: false }],
    ["ACTIVE", { edit: false, activate: false, cancel: true, unapprove: true }],
    ["EXPIRED", { edit: false, activate: false, cancel: false, unapprove: false }],
    ["CANCELLED", { edit: false, activate: false, cancel: false, unapprove: false }],
    ["REJECTED", { edit: false, activate: false, cancel: false, unapprove: false }],
  ] as const)("%s", (status, expected) => {
    expect({
      edit: isEditable(status),
      activate: canActivate(status),
      cancel: canCancel(status),
      unapprove: canUnapprove(status),
    }).toEqual(expected);
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

describe("entitledSessions and contractEndDate (A-108, A-114)", () => {
  it("adds the bonus sessions to the ones bought", () => {
    expect(entitledSessions(24, 0)).toBe(24);
    expect(entitledSessions(24, 3)).toBe(27);
  });

  it("adds the tier's validity and the bonus months and days, the start day counting", () => {
    expect(contractEndDate(day("2026-10-01"), { months: 2, days: 0 }, { months: 0, days: 0 })).toEqual(
      day("2026-11-30"),
    );
    expect(contractEndDate(day("2026-10-01"), { months: 2, days: 0 }, { months: 1, days: 5 })).toEqual(
      day("2027-01-05"),
    );
  });
});

describe("sharesProblems (A-115)", () => {
  const a = "a0000000-0000-4000-8000-000000000001";
  const b = "a0000000-0000-4000-8000-000000000002";

  it("needs shares only when required, and then a total of 100", () => {
    expect(sharesProblems([], false)).toEqual([]);
    expect(sharesProblems([], true)).toEqual(["sharesRequired"]);
    expect(sharesProblems([{ employeeId: a, percent: 100 }], true)).toEqual([]);
    expect(sharesProblems([{ employeeId: a, percent: 99.99 }], true)).toEqual(["sharesTotal"]);
  });

  it("adds fractions without drift and finds the same person twice", () => {
    expect(
      sharesProblems(
        [
          { employeeId: a, percent: 33.33 },
          { employeeId: b, percent: 66.67 },
        ],
        true,
      ),
    ).toEqual([]);
    expect(
      sharesProblems(
        [
          { employeeId: a, percent: 50 },
          { employeeId: a, percent: 50 },
        ],
        true,
      ),
    ).toEqual(["duplicateEmployee"]);
  });

  it("requires PT shares for a PT service only", () => {
    expect(ptSharesRequired("PT")).toBe(true);
    expect(ptSharesRequired("CLASS")).toBe(false);
    expect(ptSharesRequired("MEMBER")).toBe(false);
  });
});

describe("contractInputSchema", () => {
  const service = "b0000000-0000-4000-8000-000000000010";
  const employee = "a0000000-0000-4000-8000-000000000001";
  const reason = "c0000000-0000-4000-8000-000000000021";
  const valid = { serviceId: service, sessions: "24", saleShares: [{ employeeId: employee, percent: "100" }] };
  const errors = (input: unknown) => {
    const result = contractInputSchema.safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  };

  it("parses form text into typed values and fills the rest with empty ones", () => {
    expect(contractInputSchema.parse(valid)).toMatchObject({
      serviceId: service,
      sessions: 24,
      contractType: "NEW",
      previousContractId: null,
      contractDate: null,
      startDate: null,
      bonusSessions: 0,
      vatPercent: 0,
      proposedUnitPrice: null,
      exceptionReasonId: null,
      saleShares: [{ employeeId: employee, percent: 100 }],
      ptShares: [],
      companionIds: [],
      signed: false,
      firstPayment: null,
      notes: null,
    });
  });

  it.each(["0", "1001", "2.5", "x"])("rejects %j sessions", (sessions) => {
    expect(errors({ ...valid, sessions })).toEqual({ sessions: ["invalidNumber"] });
  });

  it("reads dates, an agreed price, and VAT with a decimal comma", () => {
    expect(
      contractInputSchema.parse({
        ...valid,
        contractDate: "01/10/2026",
        proposedUnitPrice: "450.000",
        exceptionReasonId: reason,
        vatPercent: "8,5",
      }),
    ).toMatchObject({ contractDate: day("2026-10-01"), proposedUnitPrice: 450_000, vatPercent: 8.5 });
  });

  it("ties an agreed price to a reason, and keeps it apart from promotions", () => {
    expect(errors({ ...valid, proposedUnitPrice: "450000" })).toEqual({ exceptionReasonId: ["required"] });
    expect(errors({ ...valid, exceptionReasonId: reason })).toEqual({ proposedUnitPrice: ["required"] });
    expect(errors({ ...valid, proposedUnitPrice: "450000", exceptionReasonId: reason, voucherCode: "ABC" })).toEqual({
      proposedUnitPrice: ["exceptionExcludesPromotion"],
    });
  });

  it("links a previous contract to a renewal only, and checks the deadline and signature", () => {
    const previous = "d0000000-0000-4000-8000-000000000001";
    expect(errors({ ...valid, previousContractId: previous })).toEqual({ previousContractId: ["newHasNoPrevious"] });
    expect(
      contractInputSchema.safeParse({ ...valid, contractType: "RENEW", previousContractId: previous }).success,
    ).toBe(true);
    expect(errors({ ...valid, startDate: "10/10/2026", activationDeadline: "09/10/2026" })).toEqual({
      activationDeadline: ["deadlineBeforeStart"],
    });
    expect(errors({ ...valid, signed: true })).toEqual({ signedOn: ["required"] });
  });

  it("names a staff member once per role and a companion once", () => {
    const twice = [
      { employeeId: employee, percent: "50" },
      { employeeId: employee, percent: "50" },
    ];
    expect(errors({ ...valid, saleShares: twice })).toEqual({ saleShares: ["duplicateEmployee"] });
    expect(errors({ ...valid, companionIds: [service, service] })).toEqual({ companionIds: ["duplicateCompanion"] });
  });

  it("takes a first payment without a day, as a receipt of the contract", () => {
    const method = "c0000000-0000-4000-8000-000000000011";
    expect(
      contractInputSchema.parse({ ...valid, firstPayment: { amount: "3.000.000", methodId: method } }).firstPayment,
    ).toMatchObject({
      amount: 3_000_000,
      methodId: method,
    });
    expect(errors({ ...valid, firstPayment: { amount: "0", methodId: method } })).toHaveProperty("firstPayment");
  });

  it("never accepts a price, total, end date, name, code, status, or opening balance from the client (BR-001, BR-301, D-011)", () => {
    const parsed = contractInputSchema.parse({
      ...valid,
      unitPrice: 1,
      contractValue: 1,
      totalSessions: 1,
      endDate: "01/01/2026",
      packageName: "Hack",
      contractCode: "HD999999",
      status: "ACTIVE",
      openingSessionsUsed: 20,
      openingPaidAmount: 12_000_000,
    });
    for (const key of [
      "unitPrice",
      "contractValue",
      "totalSessions",
      "endDate",
      "packageName",
      "contractCode",
      "status",
      "openingSessionsUsed",
      "openingPaidAmount",
    ]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });
});

describe("paymentStatusOf (brief §8.1)", () => {
  it.each([
    [12_000_000, 0, "UNPAID"],
    [12_000_000, 1, "PARTIAL"],
    [12_000_000, 11_999_999, "PARTIAL"],
    [12_000_000, 12_000_000, "PAID"],
    [0, 0, "UNPAID"],
  ] as const)("%d with %d paid is %s", (value, paid, expected) => {
    expect(paymentStatusOf(value, paid)).toBe(expected);
  });
});

describe("customerContractStatus (D-040)", () => {
  const today = day("2026-10-13");
  const active = (end: string) => ({ status: "ACTIVE" as const, endDate: day(end) });

  it("is no contract without an approved one, whatever else the customer has", () => {
    expect(customerContractStatus([], today, 30)).toBe("NO_CONTRACT");
    expect(
      customerContractStatus(
        [
          { status: "DRAFT", endDate: day("2030-01-01") },
          { status: "REJECTED", endDate: day("2030-01-01") },
          { status: "CANCELLED", endDate: day("2030-01-01") },
        ],
        today,
        30,
      ),
    ).toBe("NO_CONTRACT");
  });

  it("is training while one runs, expiring soon when the longest ends within the window, expired when all ended", () => {
    expect(customerContractStatus([active("2027-01-01")], today, 30)).toBe("TRAINING");
    expect(customerContractStatus([active("2026-11-12")], today, 30)).toBe("EXPIRING_SOON");
    expect(customerContractStatus([active("2026-11-13")], today, 30)).toBe("TRAINING");
    expect(customerContractStatus([active("2026-10-13")], today, 30)).toBe("EXPIRING_SOON");
    expect(customerContractStatus([active("2026-10-12")], today, 30)).toBe("EXPIRED");
    // A longer contract after a short one keeps the customer training.
    expect(customerContractStatus([active("2026-10-20"), active("2027-06-01")], today, 30)).toBe("TRAINING");
    expect(customerContractStatus([active("2026-01-01"), active("2026-10-20")], today, 30)).toBe("EXPIRING_SOON");
  });
});

describe("report helpers (M4.7)", () => {
  it("labels a tier band, open-ended or not", async () => {
    const { bandLabel, percentOf } = await import("./contract-report.js");
    expect(bandLabel({ min: 10, max: 19 })).toBe("10–19");
    expect(bandLabel({ min: 50, max: null })).toBe("50+");
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(1, 0)).toBe(0);
  });
});
