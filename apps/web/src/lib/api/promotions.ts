import "server-only";
import {
  promotionListSchema,
  promotionSchema,
  quoteResultSchema,
  type PromotionInput,
} from "@gymcrm/shared/promotions";
import { api, query, read } from "./client";

// Promotions and vouchers (FR-SVC-004, A-110).

/** Admin lists everything; staff get the promotions on offer, whatever is asked. */
export async function listPromotions(params: { kind?: string; onOffer?: boolean } = {}) {
  const { items } = await read(
    promotionListSchema,
    (await api()).GET("/api/v1/promotions", {
      params: { query: query({ ...params, onOffer: params.onOffer || undefined }) },
    }),
  );
  return items;
}

export async function createPromotion(input: PromotionInput) {
  return read(promotionSchema, (await api()).POST("/api/v1/promotions", { body: input as never }));
}

export async function updatePromotion(id: string, input: PromotionInput) {
  return read(
    promotionSchema,
    (await api()).PATCH("/api/v1/promotions/{id}", { params: { path: { id } }, body: input as never }),
  );
}

/** The price of a session count with a promotion, a voucher, and VAT. */
export async function quotePrice(
  serviceId: string,
  params: {
    sessions: string;
    startDate?: string;
    asOf?: string;
    promotionId?: string;
    voucherCode?: string;
    vatPercent?: string;
  },
) {
  return read(
    quoteResultSchema,
    (await api()).GET("/api/v1/services/{id}/quote", { params: { path: { id: serviceId }, query: query(params) } }),
  );
}
