import "server-only";
import { notificationPageSchema, notificationSummarySchema } from "@flow/shared/notifications";
import { api, done, query, read } from "./client";

// The signed-in user's in-app notifications (FR-PLT-009).

export async function listNotifications(params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) {
  return read(notificationPageSchema, (await api()).GET("/api/v1/notifications", { params: { query: query(params) } }));
}

export async function getNotificationSummary() {
  return read(notificationSummarySchema, (await api()).GET("/api/v1/notifications/summary"));
}

export async function markNotificationRead(id: string) {
  return done((await api()).POST("/api/v1/notifications/{id}/read", { params: { path: { id } } }));
}

export async function markAllNotificationsRead() {
  return done((await api()).POST("/api/v1/notifications/read-all"));
}
