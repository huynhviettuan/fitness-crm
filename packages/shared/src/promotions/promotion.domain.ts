/** Promotions, vouchers, discounts, and VAT on a contract's price (D-021, BR-303, A-110, A-111). Pure rules. */

export const PROMOTION_KINDS = ["PROMOTION", "VOUCHER"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const DISCOUNT_TYPES = ["PERCENT", "AMOUNT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export type Discount = { type: DiscountType; value: number };

/** The most a single promotion or voucher can take off: all of the price, never more. */
export function discountOf(base: number, discount: Discount): number {
  const raw = discount.type === "PERCENT" ? Math.round((base * discount.value) / 100) : Math.round(discount.value);
  return Math.max(0, Math.min(base, raw));
}

export type PriceBreakdown = {
  /** Unit price from the tier times the sessions. */
  gross: number;
  promotionDiscount: number;
  voucherDiscount: number;
  totalDiscount: number;
  /** After the discounts, before VAT. */
  net: number;
  vatPercent: number;
  vatAmount: number;
  /** What the customer pays: net plus VAT. */
  total: number;
};

/**
 * The price of a contract (A-110, A-111): the tier price, then the promotion, then the voucher on what is left, then VAT
 * on the discounted price. Each step is rounded to whole đồng and a discount never takes the price below zero.
 */
export function priceBreakdown(input: {
  unitPrice: number;
  sessions: number;
  promotion?: Discount | null;
  voucher?: Discount | null;
  vatPercent?: number;
}): PriceBreakdown {
  const gross = input.unitPrice * input.sessions;
  const promotionDiscount = input.promotion ? discountOf(gross, input.promotion) : 0;
  const voucherDiscount = input.voucher ? discountOf(gross - promotionDiscount, input.voucher) : 0;
  const totalDiscount = promotionDiscount + voucherDiscount;
  const net = gross - totalDiscount;
  const vatPercent = input.vatPercent ?? 0;
  const vatAmount = Math.round((net * vatPercent) / 100);
  return {
    gross,
    promotionDiscount,
    voucherDiscount,
    totalDiscount,
    net,
    vatPercent,
    vatAmount,
    total: net + vatAmount,
  };
}

/** The discount as a percent of the tier price, two decimals; 0 when the price is 0. */
export function discountPercentOf(gross: number, totalDiscount: number): number {
  return gross <= 0 ? 0 : Math.round((totalDiscount / gross) * 10_000) / 100;
}

/** A discount above what a role may approve itself goes up to a higher level (A-112). */
export function needsEscalation(discountPercent: number, approverThresholdPercent: number): boolean {
  return discountPercent > approverThresholdPercent;
}

/** A voucher code: capitals, digits, and dashes, as staff read it out and type it. */
export const VOUCHER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,18}[A-Z0-9]$/;

/** Whether `day` (a calendar day as UTC midnight) is inside the offer's dates; an empty end is open. */
export function isWithin(day: Date, from: Date | null, to: Date | null): boolean {
  return (!from || from.getTime() <= day.getTime()) && (!to || to.getTime() >= day.getTime());
}
