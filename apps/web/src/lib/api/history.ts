import "server-only";
import { auditPageSchema } from "@flow/shared/audit";
import { trashPageSchema } from "@flow/shared/trash";
import { api, query, read } from "./client";

// The trash (D-035) and the action history (T-048). Both are read-only.

type TrashQuery = { entityType?: string; from?: string; to?: string; page?: number; pageSize?: number };

export async function listTrash(params: TrashQuery) {
  return read(trashPageSchema, (await api()).GET("/api/v1/trash", { params: { query: query(params) } }));
}

type AuditQuery = {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export async function listAuditEvents(params: AuditQuery) {
  return read(auditPageSchema, (await api()).GET("/api/v1/audit-events", { params: { query: query(params) } }));
}
