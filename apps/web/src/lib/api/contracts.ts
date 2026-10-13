import "server-only";
import { contractPageSchema, contractSchema, contractStaffListSchema } from "@flow/shared/contracts";
import type { DeleteInput } from "@flow/shared/trash";
import type { RejectInput } from "@flow/shared/approvals";
import type { UnapproveInput } from "@flow/shared/contracts";
import { api, query, read, submittedOrDone } from "./client";

export async function listContracts(params: { q?: string; customerId?: string; page?: number; pageSize?: number }) {
  return read(contractPageSchema, (await api()).GET("/api/v1/contracts", { params: { query: query(params) } }));
}

/** Active employees of a branch, to name on the PT and Sale shares (A-115). */
export async function listContractStaff(branchId?: string) {
  const { items } = await read(
    contractStaffListSchema,
    (await api()).GET("/api/v1/contracts/staff", { params: { query: query({ branchId }) } }),
  );
  return items;
}

export async function getContract(id: string) {
  return read(contractSchema, (await api()).GET("/api/v1/contracts/{id}", { params: { path: { id } } }));
}

/** T-015: `idempotencyKey` is generated when the form opens, so a double submit reuses it. */
export async function createContract(customerId: string, input: unknown, idempotencyKey: string) {
  return read(
    contractSchema,
    (await api()).POST("/api/v1/customers/{id}/contracts", {
      params: { path: { id: customerId }, header: { "Idempotency-Key": idempotencyKey } },
      body: input as never,
    }),
  );
}

export async function updateContract(id: string, input: unknown) {
  return read(
    contractSchema,
    (await api()).PATCH("/api/v1/contracts/{id}", { params: { path: { id } }, body: input as never }),
  );
}

export async function activateContract(id: string) {
  return read(contractSchema, (await api()).POST("/api/v1/contracts/{id}/activate", { params: { path: { id } } }));
}

export async function cancelContract(id: string) {
  return read(contractSchema, (await api()).POST("/api/v1/contracts/{id}/cancel", { params: { path: { id } } }));
}

/** A-121: turns a pending contract down; the reason is from the `rejectReasons` list. */
export async function rejectContract(id: string, input: RejectInput) {
  return read(
    contractSchema,
    (await api()).POST("/api/v1/contracts/{id}/reject", { params: { path: { id } }, body: input }),
  );
}

/** A-124: an approved contract back to pending approval, with a reason. */
export async function unapproveContract(id: string, input: UnapproveInput) {
  return read(
    contractSchema,
    (await api()).POST("/api/v1/contracts/{id}/unapprove", { params: { path: { id } }, body: input }),
  );
}

/** A-125: moves the contract to the trash; true when the deletion waits for approval (D-018). */
export async function deleteContract(id: string, input: DeleteInput) {
  return submittedOrDone((await api()).DELETE("/api/v1/contracts/{id}", { params: { path: { id } }, body: input }));
}
