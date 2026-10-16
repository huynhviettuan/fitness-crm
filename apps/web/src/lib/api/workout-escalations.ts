import "server-only";
import { escalationPageSchema, escalationSchema, type EscalationSeenInput } from "@gymcrm/shared/workouts";
import { api, query, read } from "./client";

// The escalations of session logs (M7.4, brief §7.4).

export type EscalationParams = { status?: "WAITING" | "SEEN"; page?: number; pageSize?: number };

export async function listEscalations(params: EscalationParams) {
  return read(
    escalationPageSchema,
    (await api()).GET("/api/v1/workout/escalations", { params: { query: query(params) } }),
  );
}

export async function markEscalationSeen(id: string, input: EscalationSeenInput) {
  return read(
    escalationSchema,
    (await api()).POST("/api/v1/workout/escalations/{id}/seen", { params: { path: { id } }, body: input }),
  );
}
