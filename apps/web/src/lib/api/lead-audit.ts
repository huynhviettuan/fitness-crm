import "server-only";
import {
  consultantAuditSchema,
  criteriaListSchema,
  leadAuditSchema,
  leadsToCheckPageSchema,
  managerAuditListSchema,
  managerAuditSchema,
  unauditedLeadsPageSchema,
  type CriteriaInput,
  type ManagerAuditInput,
} from "@gymcrm/shared/leads";
import { api, query, read } from "./client";

// The automatic consulting audit (FR-LEAD-011, A-081 to A-085).

export type AuditPeriod = { from?: string; to?: string };

export async function getConsultantAudit(params: AuditPeriod) {
  return read(
    consultantAuditSchema,
    (await api()).GET("/api/v1/lead-audit/consultants", { params: { query: query(params) } }),
  );
}

export async function getLeadsToCheck(
  params: AuditPeriod & { consultantId?: string; page?: number; pageSize?: number },
) {
  return read(
    leadsToCheckPageSchema,
    (await api()).GET("/api/v1/lead-audit/leads", { params: { query: query(params) } }),
  );
}

export async function getLeadAudit(id: string) {
  return read(leadAuditSchema, (await api()).GET("/api/v1/lead-audit/leads/{id}", { params: { path: { id } } }));
}

export async function listAuditCriteria() {
  const { items } = await read(criteriaListSchema, (await api()).GET("/api/v1/lead-audit/criteria"));
  return items;
}

export async function saveAuditCriteria(input: CriteriaInput) {
  const { items } = await read(
    criteriaListSchema,
    (await api()).PUT("/api/v1/lead-audit/criteria", { body: input as never }),
  );
  return items;
}

/** Every grade of a lead, newest first: the first counts (A-086). */
export async function listManagerAudits(id: string) {
  const { items } = await read(
    managerAuditListSchema,
    (await api()).GET("/api/v1/leads/{id}/audits", { params: { path: { id } } }),
  );
  return items;
}

export async function addManagerAudit(id: string, input: ManagerAuditInput) {
  return read(
    managerAuditSchema,
    (await api()).POST("/api/v1/leads/{id}/audits", { params: { path: { id } }, body: input as never }),
  );
}

/** "Chưa audit": people no manager has audited yet, oldest first (A-088). */
export async function getAuditQueue(params: AuditPeriod & { consultantId?: string; page?: number; pageSize?: number }) {
  return read(
    unauditedLeadsPageSchema,
    (await api()).GET("/api/v1/lead-audit/queue", { params: { query: query(params) } }),
  );
}
