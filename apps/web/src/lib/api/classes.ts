import "server-only";
import {
  classListSchema,
  classSchema,
  classSessionListSchema,
  classSessionSchema,
  type ClassInput,
  type ClassUpdateInput,
  type EnrollInput,
  type MarkAttendanceInput,
} from "@flow/shared/classes";
import { api, query, read } from "./client";

// The class schedule (M5.5, brief §6.4).

export async function listClasses() {
  const { items } = await read(classListSchema, (await api()).GET("/api/v1/classes"));
  return items;
}

export async function createClass(input: ClassInput) {
  return read(classSchema, (await api()).POST("/api/v1/classes", { body: input }));
}

export async function updateClass(id: string, input: ClassUpdateInput) {
  return read(classSchema, (await api()).PATCH("/api/v1/classes/{id}", { params: { path: { id } }, body: input }));
}

/** The class sessions of `days` days from `date` (dd/MM/yyyy). */
export async function listClassSessions(params: { date: string; days?: number; branchId?: string }) {
  const { items } = await read(
    classSessionListSchema,
    (await api()).GET("/api/v1/class-sessions", { params: { query: query(params) } }),
  );
  return items;
}

export async function getClassSession(id: string) {
  return read(classSessionSchema, (await api()).GET("/api/v1/class-sessions/{id}", { params: { path: { id } } }));
}

export async function enrollCustomer(id: string, input: EnrollInput) {
  return read(
    classSessionSchema,
    (await api()).POST("/api/v1/class-sessions/{id}/attendees", { params: { path: { id } }, body: input }),
  );
}

export async function removeAttendee(id: string, attendeeId: string) {
  return read(
    classSessionSchema,
    (await api()).DELETE("/api/v1/class-sessions/{id}/attendees/{attendeeId}", {
      params: { path: { id, attendeeId } },
    }),
  );
}

export async function markAttendee(id: string, attendeeId: string, input: MarkAttendanceInput) {
  return read(
    classSessionSchema,
    (await api()).POST("/api/v1/class-sessions/{id}/attendees/{attendeeId}/mark", {
      params: { path: { id, attendeeId } },
      body: input,
    }),
  );
}
