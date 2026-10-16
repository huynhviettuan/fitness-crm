import { z } from "zod";
import { calendarDate, hasNoControlCharacters, optionalCalendarDate, vndAmount } from "../validation/index.js";
import { DISCOUNT_TYPES, PROMOTION_KINDS, VOUCHER_CODE_PATTERN } from "./promotion.domain.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Forms send text; an empty optional field is stored as null.

/** A number typed in a form: "10", "12.5", or "1.500.000" for an amount. */
const amountOrPercent = z.union([z.number(), z.string()], { error: "invalidNumber" });

export const promotionInputSchema = z
  .object({
    kind: z.enum(PROMOTION_KINDS, { error: "invalidChoice" }),
    name: z
      .string({ error: "required" })
      .trim()
      .min(1, { error: "required" })
      .max(100, { error: "tooLong" })
      .refine(hasNoControlCharacters, { error: "invalidCharacters" })
      .regex(/^[^\r\n\t]*$/, { error: "invalidCharacters" }),
    /** A voucher is found by its code; a promotion has none. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .prefault("")
      .transform((value) => (value === "" ? null : value)),
    discountType: z.enum(DISCOUNT_TYPES, { error: "invalidChoice" }),
    value: amountOrPercent,
    validFrom: optionalCalendarDate.prefault(""),
    validTo: optionalCalendarDate.prefault(""),
    /** The services it applies to; none means every service. */
    serviceIds: z
      .array(z.uuid({ error: "invalidChoice" }))
      .max(100, { error: "tooLong" })
      .prefault([]),
    active: z.boolean({ error: "invalidChoice" }).prefault(true),
  })
  .transform((data, ctx) => {
    const text = typeof data.value === "number" ? String(data.value) : data.value.trim();
    // An amount is whole đồng, optionally grouped by thousands ("1.500.000"); a percent may have a decimal comma or dot.
    const amount = data.discountType === "AMOUNT" ? vndAmount.safeParse(text) : null;
    const value = amount ? (amount.success ? amount.data : Number.NaN) : Number(text.replace(",", "."));
    const valid =
      text !== "" &&
      Number.isFinite(value) &&
      (data.discountType === "PERCENT" ? value > 0 && value <= 100 : Number.isSafeInteger(value) && value > 0);
    if (!valid) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: data.discountType === "PERCENT" ? "invalidPercent" : "invalidAmount",
      });
      return z.NEVER;
    }
    if (data.kind === "VOUCHER" && !data.code) ctx.addIssue({ code: "custom", path: ["code"], message: "required" });
    if (data.kind === "VOUCHER" && data.code && !VOUCHER_CODE_PATTERN.test(data.code)) {
      ctx.addIssue({ code: "custom", path: ["code"], message: "invalidVoucherCode" });
    }
    if (data.kind === "PROMOTION" && data.code)
      ctx.addIssue({ code: "custom", path: ["code"], message: "promotionHasNoCode" });
    if (data.validFrom && data.validTo && data.validTo.getTime() < data.validFrom.getTime()) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "endBeforeStart" });
    }
    return {
      ...data,
      value: data.discountType === "PERCENT" ? Math.round(value * 100) / 100 : value,
      serviceIds: [...new Set(data.serviceIds)],
    };
  });

export const listPromotionsSchema = z.object({
  kind: z.enum(PROMOTION_KINDS).optional(),
  /** Only those that can be used today. */
  onOffer: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

/** What a contract would cost with a promotion, a voucher, and VAT (A-110, A-111). */
export const quoteSchema = z.object({
  sessions: z.coerce.number().int().min(1).max(1000),
  startDate: calendarDate.optional(),
  asOf: calendarDate.optional(),
  promotionId: z.uuid().optional(),
  voucherCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .refine(hasNoControlCharacters)
    .optional()
    .transform((value) => value || undefined),
  vatPercent: z.coerce.number().min(0).max(100).optional(),
});

export type PromotionInput = z.input<typeof promotionInputSchema>;
