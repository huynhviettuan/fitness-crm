import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exceedsContractValue, isFutureDay, monthRange } from "@/modules/finance/finance.domain";
import { cashTransactionInputSchema, paymentInputSchema, voidSchema } from "@/modules/finance/finance.schema";

describe("exceedsContractValue (OQ-003 interim, D-011)", () => {
  const contract = { contractValue: 12_000_000, openingPaidAmount: 2_000_000, confirmedPaidAmount: 6_000_000 };

  it("allows paying exactly the rest, counting the opening balance", () => {
    expect(exceedsContractValue(contract, 4_000_000)).toBe(false);
    expect(exceedsContractValue(contract, 4_000_001)).toBe(true);
  });
});

describe("isFutureDay", () => {
  it("allows today and earlier", () => {
    const today = new Date("2026-10-10T00:00:00Z");
    expect(isFutureDay(today, today)).toBe(false);
    expect(isFutureDay(new Date("2026-10-11T00:00:00Z"), today)).toBe(true);
  });
});

describe("monthRange", () => {
  it("covers the whole month, including leap days", () => {
    expect(monthRange("2028-02")).toEqual({ from: new Date("2028-02-01T00:00:00Z"), to: new Date("2028-02-29T00:00:00Z") });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("10/2026")).toBeNull();
  });
});

describe("finance schemas", () => {
  const errors = (schema: z.ZodType, input: unknown) => {
    const result = schema.safeParse(input);
    return result.success ? {} : z.flattenError(result.error).fieldErrors;
  };

  it("a payment needs a positive whole amount, a known method, and a date", () => {
    expect(paymentInputSchema.parse({ amount: "5.000.000", method: "E_WALLET", paidOn: "05/10/2026" })).toEqual({
      amount: 5_000_000,
      method: "E_WALLET",
      paidOn: new Date("2026-10-05T00:00:00Z"),
    });
    expect(errors(paymentInputSchema, { amount: "0", method: "", paidOn: "5/10/2026" })).toEqual({
      amount: ["amountNotPositive"],
      method: ["invalidChoice"],
      paidOn: ["invalidDate"],
    });
  });

  it("never accepts a status from the client", () => {
    const parsed = paymentInputSchema.parse({ amount: 1, method: "CASH", paidOn: "05/10/2026", status: "VOIDED" });
    expect(parsed).not.toHaveProperty("status");
  });

  it("a cash entry needs a category; reference and description are optional", () => {
    expect(cashTransactionInputSchema.parse({ type: "INCOME", category: " Bán nước ", amount: 1, occurredOn: "05/10/2026" })).toMatchObject({
      category: "Bán nước",
      reference: null,
      description: null,
    });
    expect(errors(cashTransactionInputSchema, { type: "INCOME", category: "\u0000", amount: 1, occurredOn: "05/10/2026" })).toEqual({
      category: ["invalidCharacters"],
    });
  });

  it("a void needs a reason", () => {
    expect(errors(voidSchema, { reason: "   " })).toEqual({ reason: ["required"] });
    expect(errors(voidSchema, {})).toEqual({ reason: [expect.any(String)] });
  });
});
