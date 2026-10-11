import "server-only";
import {
  leadAssigneesSchema,
  leadBoardSchema,
  leadPageSchema,
  leadSchema,
  leadTimelineSchema,
  type LeadAssignInput,
  type LeadInput,
  type LeadStatus,
  type LeadStatusChangeInput,
  type LeadUpdateInput,
} from "@flow/shared/leads";
import { api, query, read } from "./client";

// Leads (brief §4.1): people before Show, in the record they keep as customers (D-019).

export type LeadQuery = {
  q?: string;
  status?: LeadStatus;
  channelId?: string;
  sourceId?: string;
  needGroupId?: string;
  page?: number;
};
export type LeadBoardQuery = Omit<LeadQuery, "status" | "page">;

export async function listLeads(params: LeadQuery) {
  return read(leadPageSchema, (await api()).GET("/api/v1/leads", { params: { query: query(params) } }));
}

export async function getLead(id: string) {
  return read(leadSchema, (await api()).GET("/api/v1/leads/{id}", { params: { path: { id } } }));
}

export async function createLead(input: LeadInput) {
  return read(leadSchema, (await api()).POST("/api/v1/leads", { body: input as never }));
}

export async function updateLead(id: string, input: LeadUpdateInput) {
  return read(
    leadSchema,
    (await api()).PATCH("/api/v1/leads/{id}", { params: { path: { id } }, body: input as never }),
  );
}

/** The Kanban board (FR-LEAD-006). */
export async function getLeadBoard(params: LeadBoardQuery) {
  return read(leadBoardSchema, (await api()).GET("/api/v1/leads/board", { params: { query: query(params) } }));
}

export async function getLeadTimeline(id: string) {
  return read(leadTimelineSchema, (await api()).GET("/api/v1/leads/{id}/timeline", { params: { path: { id } } }));
}

export async function changeLeadStatus(id: string, input: LeadStatusChangeInput) {
  return read(
    leadSchema,
    (await api()).POST("/api/v1/leads/{id}/status", { params: { path: { id } }, body: input as never }),
  );
}

export async function listLeadAssignees(id: string) {
  const { items } = await read(
    leadAssigneesSchema,
    (await api()).GET("/api/v1/leads/{id}/assignees", { params: { path: { id } } }),
  );
  return items;
}

export async function assignLead(id: string, input: LeadAssignInput) {
  return read(leadSchema, (await api()).POST("/api/v1/leads/{id}/assign", { params: { path: { id } }, body: input }));
}
