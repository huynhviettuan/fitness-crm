import "server-only";
import { branchListSchema, branchSchema, type BranchInput } from "@gymcrm/shared/branches";
import { api, read } from "./client";

export async function listBranches() {
  const { items } = await read(branchListSchema, (await api()).GET("/api/v1/branches"));
  return items;
}

export async function createBranch(input: BranchInput) {
  return read(branchSchema, (await api()).POST("/api/v1/branches", { body: input }));
}

export async function updateBranch(id: string, input: BranchInput) {
  return read(branchSchema, (await api()).PATCH("/api/v1/branches/{id}", { params: { path: { id } }, body: input }));
}
