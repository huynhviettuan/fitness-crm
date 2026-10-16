import "server-only";
import {
  notificationPreferencesSchema,
  notificationSettingsSchema,
  pushKeySchema,
  type NotificationPreferencesInput,
  type NotificationSettingsInput,
  type PushSubscriptionInput,
} from "@gymcrm/shared/notifications";
import { api, done, read } from "./client";

// Staff notifications by email and on the phone (M6.4, D-053, D-056).

export async function getNotificationPreferences() {
  return read(notificationPreferencesSchema, (await api()).GET("/api/v1/notification-preferences"));
}

export async function saveNotificationPreferences(input: NotificationPreferencesInput) {
  return read(notificationPreferencesSchema, (await api()).PUT("/api/v1/notification-preferences", { body: input }));
}

export async function getNotificationSettings() {
  return read(notificationSettingsSchema, (await api()).GET("/api/v1/notification-settings"));
}

export async function saveNotificationSettings(input: NotificationSettingsInput) {
  return read(notificationSettingsSchema, (await api()).PUT("/api/v1/notification-settings", { body: input }));
}

/** The public key a browser subscribes with; empty while push is not set up. */
export async function getPushKey() {
  return read(pushKeySchema, (await api()).GET("/api/v1/push/key"));
}

export async function subscribePush(input: PushSubscriptionInput) {
  return done((await api()).PUT("/api/v1/push/subscription", { body: input }));
}

export async function unsubscribePush(endpoint: string) {
  return done((await api()).POST("/api/v1/push/unsubscribe", { body: { endpoint } }));
}
