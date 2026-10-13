import "server-only";
import {
  priceLookupSchema,
  serviceDetailSchema,
  serviceListSchema,
  type QuickPackagesInput,
  type ServiceInput,
  type TiersInput,
} from "@flow/shared/services";
import { api, query, read } from "./client";

// Services and their price tiers (FR-SVC-001 to FR-SVC-003, D-021).

export async function listServices(params: { kind?: string; branchId?: string; onSale?: boolean } = {}) {
  const { items } = await read(
    serviceListSchema,
    (await api()).GET("/api/v1/services", {
      params: { query: query({ ...params, onSale: params.onSale || undefined }) },
    }),
  );
  return items;
}

export async function getService(id: string) {
  return read(serviceDetailSchema, (await api()).GET("/api/v1/services/{id}", { params: { path: { id } } }));
}

export async function createService(input: ServiceInput) {
  return read(serviceDetailSchema, (await api()).POST("/api/v1/services", { body: input as never }));
}

/** Sets the picture of a service from an uploaded file, or takes it off with null (M4.1b, A-143). */
export async function setServiceImage(id: string, fileId: string | null) {
  return read(
    serviceDetailSchema,
    (await api()).PUT("/api/v1/services/{id}/image", { params: { path: { id } }, body: { fileId } }),
  );
}

export async function updateService(id: string, input: ServiceInput) {
  return read(
    serviceDetailSchema,
    (await api()).PATCH("/api/v1/services/{id}", { params: { path: { id } }, body: input as never }),
  );
}

/** A new version of the whole tier set, from a day on (BR-301). */
export async function saveTiers(id: string, input: TiersInput) {
  return read(
    serviceDetailSchema,
    (await api()).PUT("/api/v1/services/{id}/tiers", { params: { path: { id } }, body: input as never }),
  );
}

export async function saveQuickPackages(id: string, input: QuickPackagesInput) {
  return read(
    serviceDetailSchema,
    (await api()).PUT("/api/v1/services/{id}/quick-packages", { params: { path: { id } }, body: input as never }),
  );
}

export async function lookupPrice(id: string, params: { sessions: string; startDate?: string; asOf?: string }) {
  return read(
    priceLookupSchema,
    (await api()).GET("/api/v1/services/{id}/lookup", { params: { path: { id }, query: query(params) } }),
  );
}
