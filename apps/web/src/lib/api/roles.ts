import "server-only";
import { roleListSchema, roleSchema } from "@flow/shared/roles";
import { api, read } from "./client";

// The role editor passes form input through as is; the API validates it.

export async function listRoles() {
  const { items } = await read(roleListSchema, (await api()).GET("/api/v1/roles"));
  return items;
}

export async function getRole(id: string) {
  return read(roleSchema, (await api()).GET("/api/v1/roles/{id}", { params: { path: { id } } }));
}

export async function createRole(input: unknown) {
  return read(roleSchema, (await api()).POST("/api/v1/roles", { body: input as never }));
}

export async function updateRole(id: string, input: unknown) {
  return read(roleSchema, (await api()).PUT("/api/v1/roles/{id}", { params: { path: { id } }, body: input as never }));
}

export async function cloneRole(id: string, input: unknown) {
  return read(roleSchema, (await api()).POST("/api/v1/roles/{id}/clone", { params: { path: { id } }, body: input as never }));
}
