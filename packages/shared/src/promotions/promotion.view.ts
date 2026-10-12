import { z } from "zod";
import { instant, listOf } from "../validation/index.js";
import { priceLookupSchema } from "../services/service.view.js";
import { DISCOUNT_TYPES, PROMOTION_KINDS } from "./promotion.domain.js";

export const promotionSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(PROMOTION_KINDS),
    name: z.string(),
    /** Only for those who manage promotions; staff type a voucher's code, they do not list it. */
    code: z.string().nullable(),
    discountType: z.enum(DISCOUNT_TYPES),
    value: z.number(),
    validFrom: instant.nullable(),
    validTo: instant.nullable(),
    /** Empty: every service. */
    services: z.array(z.object({ id: z.uuid(), name: z.string() })),
    active: z.boolean(),
    createdAt: instant,
  })
  .meta({ id: "Promotion" });
export type Promotion = z.infer<typeof promotionSchema>;

export const promotionListSchema = listOf(promotionSchema).meta({ id: "PromotionList" });

export const priceBreakdownSchema = z.object({
  gross: z.number(),
  promotionDiscount: z.number(),
  voucherDiscount: z.number(),
  totalDiscount: z.number(),
  net: z.number(),
  vatPercent: z.number(),
  vatAmount: z.number(),
  total: z.number(),
});

/** The tier lookup plus what the promotion, the voucher, and VAT do to the price. */
export const quoteResultSchema = priceLookupSchema
  .extend({
    promotion: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    voucher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    breakdown: priceBreakdownSchema,
    /** The total discount as a percent of the tier price. */
    discountPercent: z.number(),
  })
  .meta({ id: "PriceQuote" });
export type PriceQuote = z.infer<typeof quoteResultSchema>;
