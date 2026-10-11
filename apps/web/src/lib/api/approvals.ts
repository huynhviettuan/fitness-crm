import "server-only";
import {
  approvalRequestPageSchema,
  approvalRuleListSchema,
  approvalRuleSchema,
  approvalSummarySchema,
  type ApprovalAction,
  type ApprovalRuleInput,
  type RejectInput,
} from "@flow/shared/approvals";
import { api, done, query, read } from "./client";

// Approvals (D-018): the inbox, decisions, and the matrix.

export async function listApprovals(params: { view?: string; status?: string; page?: number }) {
  return read(approvalRequestPageSchema, (await api()).GET("/api/v1/approvals", { params: { query: query(params) } }));
}

export async function getApprovalSummary() {
  return read(approvalSummarySchema, (await api()).GET("/api/v1/approvals/summary"));
}

export async function approveRequest(id: string) {
  return done((await api()).POST("/api/v1/approvals/{id}/approve", { params: { path: { id } } }));
}

export async function rejectRequest(id: string, input: RejectInput) {
  return done((await api()).POST("/api/v1/approvals/{id}/reject", { params: { path: { id } }, body: input }));
}

export async function listApprovalRules() {
  const { items } = await read(approvalRuleListSchema, (await api()).GET("/api/v1/approval-rules"));
  return items;
}

export async function updateApprovalRule(action: ApprovalAction, input: ApprovalRuleInput) {
  return read(
    approvalRuleSchema,
    (await api()).PUT("/api/v1/approval-rules/{action}", { params: { path: { action } }, body: input as never }),
  );
}
