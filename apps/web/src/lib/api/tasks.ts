import "server-only";
import {
  taskAssigneesSchema,
  taskDetailSchema,
  taskPageSchema,
  taskSummarySchema,
  type TaskCommentInput,
  type TaskInput,
  type TaskStatus,
  type TaskUpdateInput,
  type TaskView,
} from "@flow/shared/tasks";
import { api, query, read } from "./client";

// Giao việc (brief §8.2, D-037).

export type TaskQuery = { view?: TaskView; status?: TaskStatus; overdueOnly?: boolean; q?: string; page?: number; pageSize?: number };

export async function listTasks(params: TaskQuery) {
  return read(taskPageSchema, (await api()).GET("/api/v1/tasks", { params: { query: query(params) } }));
}

export async function getTaskSummary() {
  return read(taskSummarySchema, (await api()).GET("/api/v1/tasks/summary"));
}

export async function getTaskAssignees() {
  return read(taskAssigneesSchema, (await api()).GET("/api/v1/tasks/assignees"));
}

export async function getTask(id: string) {
  return read(taskDetailSchema, (await api()).GET("/api/v1/tasks/{id}", { params: { path: { id } } }));
}

export async function createTask(input: TaskInput) {
  return read(taskDetailSchema, (await api()).POST("/api/v1/tasks", { body: input as never }));
}

export async function updateTask(id: string, input: TaskUpdateInput) {
  return read(taskDetailSchema, (await api()).PATCH("/api/v1/tasks/{id}", { params: { path: { id } }, body: input as never }));
}

export type TaskMove = "accept" | "start" | "complete" | "cancel";

export async function moveTask(id: string, move: TaskMove) {
  const client = await api();
  const options = { params: { path: { id } } };
  const call = {
    accept: () => client.POST("/api/v1/tasks/{id}/accept", options),
    start: () => client.POST("/api/v1/tasks/{id}/start", options),
    complete: () => client.POST("/api/v1/tasks/{id}/complete", options),
    cancel: () => client.POST("/api/v1/tasks/{id}/cancel", options),
  }[move];
  return read(taskDetailSchema, call());
}

export async function addTaskComment(id: string, input: TaskCommentInput) {
  return read(taskDetailSchema, (await api()).POST("/api/v1/tasks/{id}/comments", { params: { path: { id } }, body: input as never }));
}
