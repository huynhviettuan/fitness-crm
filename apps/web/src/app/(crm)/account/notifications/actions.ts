"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { saveNotificationPreferences, subscribePush, unsubscribePush } from "@/lib/api/staff-notifications";
import type { NotificationPreferencesInput, PushSubscriptionInput } from "@flow/shared/notifications";

export async function savePreferencesAction(input: NotificationPreferencesInput): Promise<ActionResult> {
  return runAction(async () => {
    await saveNotificationPreferences(input);
  });
}

export async function subscribePushAction(input: PushSubscriptionInput): Promise<ActionResult> {
  return runAction(async () => {
    await subscribePush(input);
  });
}

export async function unsubscribePushAction(endpoint: string): Promise<ActionResult> {
  return runAction(async () => {
    await unsubscribePush(endpoint);
  });
}
