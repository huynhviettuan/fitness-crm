"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { saveNotificationSettings } from "@/lib/api/staff-notifications";
import type { NotificationSettingsInput } from "@gymcrm/shared/notifications";

export async function saveSettingsAction(input: NotificationSettingsInput): Promise<ActionResult> {
  return runAction(async () => {
    await saveNotificationSettings(input);
  });
}
