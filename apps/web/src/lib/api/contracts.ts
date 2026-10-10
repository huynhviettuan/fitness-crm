import "server-only";
import { contractPageSchema, contractSchema, type ContractInput } from "@flow/shared/contracts";
import { api, query, read } from "./client";

export async function listContracts(params: { q?: string; customerId?: string; page?: number; pageSize?: number }) {
  return read(contractPageSchema, (await api()).GET("/api/v1/contracts", { params: { query: query(params) } }));
}

export async function getContract(id: string) {
  return read(contractSchema, (await api()).GET("/api/v1/contracts/{id}", { params: { path: { id } } }));
}

/** T-015: `idempotencyKey` is generated when the form opens, so a double submit reuses it. */
export async function createContract(customerId: string, input: ContractInput, idempotencyKey: string) {
  return read(
    contractSchema,
    (await api()).POST("/api/v1/customers/{id}/contracts", {
      params: { path: { id: customerId }, header: { "Idempotency-Key": idempotencyKey } },
      body: input,
    }),
  );
}

export async function updateContract(id: string, input: ContractInput) {
  return read(contractSchema, (await api()).PATCH("/api/v1/contracts/{id}", { params: { path: { id } }, body: input }));
}

export async function activateContract(id: string) {
  return read(contractSchema, (await api()).POST("/api/v1/contracts/{id}/activate", { params: { path: { id } } }));
}

export async function cancelContract(id: string) {
  return read(contractSchema, (await api()).POST("/api/v1/contracts/{id}/cancel", { params: { path: { id } } }));
}
