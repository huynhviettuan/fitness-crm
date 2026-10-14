import "server-only";
import { ptPayoutDetailSchema, ptPayoutPageSchema, type PtPayoutInput } from "@flow/shared/payouts";
import { api, query, read } from "./client";

// PT payouts (M5.7, FR-CASH-003).

export type PayoutParams = { trainerId?: string; from?: string; to?: string; page?: number; pageSize?: number };

export async function listPayouts(params: PayoutParams) {
  return read(ptPayoutPageSchema, (await api()).GET("/api/v1/payouts", { params: { query: query(params) } }));
}

export async function getPayout(id: string) {
  return read(ptPayoutDetailSchema, (await api()).GET("/api/v1/payouts/{id}", { params: { path: { id } } }));
}

/** T-015: `idempotencyKey` is generated when the dialog opens, so a double submit reuses it. */
export async function createPayout(input: PtPayoutInput, idempotencyKey: string) {
  return read(
    ptPayoutDetailSchema,
    (await api()).POST("/api/v1/payouts", { params: { header: { "Idempotency-Key": idempotencyKey } }, body: input }),
  );
}
