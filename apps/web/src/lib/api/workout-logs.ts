import "server-only";
import { logPageSchema, logSchema, type LogContentInput } from "@gymcrm/shared/workouts";
import { api, query, read } from "./client";

// The session logs of PT sessions (M7.3, brief §7.3).

export type LogParams = { customerId?: string; trainerId?: string; page?: number; pageSize?: number };

export async function listLogs(params: LogParams) {
  return read(logPageSchema, (await api()).GET("/api/v1/workout/logs", { params: { query: query(params) } }));
}

export async function getLog(id: string) {
  return read(logSchema, (await api()).GET("/api/v1/workout/logs/{id}", { params: { path: { id } } }));
}

/** Opens the log of a PT session, or the one already open. */
export async function openLog(bookingId: string) {
  return read(logSchema, (await api()).POST("/api/v1/workout/logs", { body: { bookingId } }));
}

export async function updateLog(id: string, input: LogContentInput) {
  return read(
    logSchema,
    (await api()).PUT("/api/v1/workout/logs/{id}", { params: { path: { id } }, body: input as never }),
  );
}
