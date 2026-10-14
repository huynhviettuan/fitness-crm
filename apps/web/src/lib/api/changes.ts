import "server-only";
import { voucherPageSchema, voucherSchema, type HoldInput, type RenewalInput } from "@flow/shared/changes";
import { api, query, read } from "./client";

// The change vouchers of contracts (M8, brief §5.6).

export type VoucherParams = {
  contractId?: string;
  customerId?: string;
  kind?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function listVouchers(params: VoucherParams) {
  return read(
    voucherPageSchema,
    (await api()).GET("/api/v1/contract-changes", { params: { query: query(params) as never } }),
  );
}

/** T-015: the key is made when the form opens, so a double submit raises one voucher. */
export async function raiseRenewal(input: RenewalInput, idempotencyKey: string) {
  return read(
    voucherSchema,
    (await api()).POST("/api/v1/contract-changes/renewals", {
      params: { header: { "Idempotency-Key": idempotencyKey } },
      body: input as never,
    }),
  );
}

export async function raiseHold(input: HoldInput, idempotencyKey: string) {
  return read(
    voucherSchema,
    (await api()).POST("/api/v1/contract-changes/holds", {
      params: { header: { "Idempotency-Key": idempotencyKey } },
      body: input as never,
    }),
  );
}
