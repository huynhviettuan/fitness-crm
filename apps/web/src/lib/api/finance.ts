import "server-only";
import {
  cashTransactionPageSchema,
  cashTransactionSchema,
  collectedSchema,
  debtPageSchema,
  financeSummarySchema,
  paymentPageSchema,
  paymentSchema,
  type CashTransactionInput,
  type PaymentInput,
  type VoidInput,
} from "@flow/shared/finance";
import { api, query, read } from "./client";

/** First and last gym day, inclusive (dd/MM/yyyy). */
type Period = { from: string; to: string };

type PaymentQuery = Partial<Period> & { contractId?: string; customerId?: string; page?: number; pageSize?: number };

export async function listPayments(params: PaymentQuery) {
  return read(paymentPageSchema, (await api()).GET("/api/v1/payments", { params: { query: query(params) } }));
}

/** Confirmed payments received in the period (D-011: no opening balances). */
export async function collectedBetween(period: Period) {
  const { total } = await read(collectedSchema, (await api()).GET("/api/v1/payments/collected", { params: { query: period } }));
  return total;
}

/** T-015: `idempotencyKey` is generated when the form opens, so a double submit reuses it. */
export async function recordPayment(contractId: string, input: PaymentInput, idempotencyKey: string) {
  return read(
    paymentSchema,
    (await api()).POST("/api/v1/contracts/{id}/payments", {
      params: { path: { id: contractId }, header: { "Idempotency-Key": idempotencyKey } },
      body: input,
    }),
  );
}

export async function voidPayment(id: string, input: VoidInput) {
  return read(paymentSchema, (await api()).POST("/api/v1/payments/{id}/void", { params: { path: { id } }, body: input }));
}

/** Contracts that still owe money, largest debt first (BR-013, A-022). */
export async function listDebts(params: { page?: number }) {
  return read(debtPageSchema, (await api()).GET("/api/v1/debts", { params: { query: query(params) } }));
}

export async function listCashTransactions(params: Partial<Period> & { page?: number; pageSize?: number }) {
  return read(
    cashTransactionPageSchema,
    (await api()).GET("/api/v1/cash-transactions", { params: { query: query(params) } }),
  );
}

export async function financeSummary(period: Period) {
  return read(financeSummarySchema, (await api()).GET("/api/v1/cash-transactions/summary", { params: { query: period } }));
}

export async function recordCashTransaction(input: CashTransactionInput, idempotencyKey: string) {
  return read(
    cashTransactionSchema,
    (await api()).POST("/api/v1/cash-transactions", { params: { header: { "Idempotency-Key": idempotencyKey } }, body: input }),
  );
}

export async function voidCashTransaction(id: string, input: VoidInput) {
  return read(
    cashTransactionSchema,
    (await api()).POST("/api/v1/cash-transactions/{id}/void", { params: { path: { id } }, body: input }),
  );
}
