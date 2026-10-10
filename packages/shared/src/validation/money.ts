import { z } from "zod";

// NUMERIC(14,0) (A-002).
const MAX_VND = 99_999_999_999_999;
// Whole đồng, optionally grouped by thousands: 12000000, 12.000.000, 12,000,000, 12 000 000.
const GROUPED_DIGITS = /^(\d+|\d{1,3}([.,\s]\d{3})+)$/;

/**
 * A whole VND amount (A-002), from a number or text typed in a form. Fractions are
 * rejected rather than rounded. Error messages are i18n keys under `validation.*`.
 */
export const vndAmount = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!GROUPED_DIGITS.test(text)) {
    ctx.addIssue({ code: "custom", message: text === "" ? "required" : "invalidAmount" });
    return z.NEVER;
  }
  const amount = Number(text.replace(/[.,\s]/g, ""));
  if (!Number.isSafeInteger(amount) || amount > MAX_VND) {
    ctx.addIssue({ code: "custom", message: "invalidAmount" });
    return z.NEVER;
  }
  return amount;
});
