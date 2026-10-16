import { describe, expect, it } from "vitest";
import { discountOf, discountPercentOf, isWithin, needsEscalation, priceBreakdown } from "./promotion.domain.js";
import { promotionInputSchema } from "./promotion.schema.js";

describe("discountOf", () => {
  it("takes a percent of the base, rounded to whole đồng", () => {
    expect(discountOf(7_800_000, { type: "PERCENT", value: 10 })).toBe(780_000);
    expect(discountOf(1_000_001, { type: "PERCENT", value: 12.5 })).toBe(125_000);
  });

  it("takes an amount, never more than the base", () => {
    expect(discountOf(7_800_000, { type: "AMOUNT", value: 500_000 })).toBe(500_000);
    expect(discountOf(300_000, { type: "AMOUNT", value: 500_000 })).toBe(300_000);
    expect(discountOf(300_000, { type: "PERCENT", value: 100 })).toBe(300_000);
  });
});

describe("priceBreakdown (A-110, A-111)", () => {
  it("is the tier price when there is nothing to take off", () => {
    expect(priceBreakdown({ unitPrice: 650_000, sessions: 12 })).toEqual({
      gross: 7_800_000,
      promotionDiscount: 0,
      voucherDiscount: 0,
      totalDiscount: 0,
      net: 7_800_000,
      vatPercent: 0,
      vatAmount: 0,
      total: 7_800_000,
    });
  });

  it("applies the promotion, then the voucher on what is left, then VAT on the discounted price", () => {
    const result = priceBreakdown({
      unitPrice: 1_000_000,
      sessions: 10,
      promotion: { type: "PERCENT", value: 10 },
      voucher: { type: "PERCENT", value: 10 },
      vatPercent: 8,
    });

    expect(result.promotionDiscount).toBe(1_000_000);
    // The voucher's 10% is of 9,000,000, not of the tier price.
    expect(result.voucherDiscount).toBe(900_000);
    expect(result).toMatchObject({ totalDiscount: 1_900_000, net: 8_100_000, vatAmount: 648_000, total: 8_748_000 });
  });

  it("never goes below zero", () => {
    const result = priceBreakdown({
      unitPrice: 100_000,
      sessions: 2,
      promotion: { type: "AMOUNT", value: 150_000 },
      voucher: { type: "AMOUNT", value: 150_000 },
    });

    expect(result).toMatchObject({ promotionDiscount: 150_000, voucherDiscount: 50_000, net: 0, total: 0 });
  });
});

describe("discountPercentOf and needsEscalation (A-112)", () => {
  it("reads a discount as a percent of the tier price", () => {
    expect(discountPercentOf(7_800_000, 780_000)).toBe(10);
    expect(discountPercentOf(3, 1)).toBe(33.33);
    expect(discountPercentOf(0, 0)).toBe(0);
  });

  it("escalates only above the approver's threshold", () => {
    expect(needsEscalation(10, 10)).toBe(false);
    expect(needsEscalation(10.01, 10)).toBe(true);
    expect(needsEscalation(0, 0)).toBe(false);
    expect(needsEscalation(1, 0)).toBe(true);
  });
});

describe("isWithin", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("includes both end days and treats an empty end as open", () => {
    expect(isWithin(day("2026-10-10"), day("2026-10-10"), day("2026-10-20"))).toBe(true);
    expect(isWithin(day("2026-10-20"), day("2026-10-10"), day("2026-10-20"))).toBe(true);
    expect(isWithin(day("2026-10-21"), day("2026-10-10"), day("2026-10-20"))).toBe(false);
    expect(isWithin(day("2026-10-09"), day("2026-10-10"), null)).toBe(false);
    expect(isWithin(day("2030-01-01"), null, null)).toBe(true);
  });
});

describe("promotionInputSchema", () => {
  const base = { kind: "PROMOTION", name: " Tết ", discountType: "PERCENT", value: "10" };

  it("reads a percent and an amount typed in a form", () => {
    expect(promotionInputSchema.parse(base)).toMatchObject({
      name: "Tết",
      value: 10,
      code: null,
      serviceIds: [],
      active: true,
    });
    expect(promotionInputSchema.parse({ ...base, value: "12,5" }).value).toBe(12.5);
    expect(promotionInputSchema.parse({ ...base, discountType: "AMOUNT", value: "1.500.000" }).value).toBe(1_500_000);
  });

  it("refuses a percent over 100, an amount with a fraction, and no value", () => {
    expect(promotionInputSchema.safeParse({ ...base, value: "101" }).success).toBe(false);
    expect(promotionInputSchema.safeParse({ ...base, value: "0" }).success).toBe(false);
    expect(promotionInputSchema.safeParse({ ...base, discountType: "AMOUNT", value: "1000.5" }).success).toBe(false);
    expect(promotionInputSchema.safeParse({ ...base, value: "" }).success).toBe(false);
  });

  it("gives a voucher a code and a promotion none", () => {
    expect(promotionInputSchema.parse({ ...base, kind: "VOUCHER", code: " tet-2027 " }).code).toBe("TET-2027");
    expect(promotionInputSchema.safeParse({ ...base, kind: "VOUCHER" }).success).toBe(false);
    expect(promotionInputSchema.safeParse({ ...base, kind: "VOUCHER", code: "a b" }).success).toBe(false);
    expect(promotionInputSchema.safeParse({ ...base, code: "TET" }).success).toBe(false);
  });

  it("refuses an end before the start", () => {
    expect(promotionInputSchema.safeParse({ ...base, validFrom: "10/10/2026", validTo: "09/10/2026" }).success).toBe(
      false,
    );
    expect(promotionInputSchema.safeParse({ ...base, validFrom: "10/10/2026", validTo: "10/10/2026" }).success).toBe(
      true,
    );
  });
});
