import "server-only";
import { leadPageSchema, leadSchema, type LeadInput, type LeadStatus, type LeadUpdateInput } from "@flow/shared/leads";
import { api, query, read } from "./client";

// Leads (brief §4.1): people before Show, in the record they keep as customers (D-019).

export type LeadQuery = { q?: string; status?: LeadStatus; channelId?: string; sourceId?: string; needGroupId?: string; page?: number };

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
  return read(leadSchema, (await api()).PATCH("/api/v1/leads/{id}", { params: { path: { id } }, body: input as never }));
}
