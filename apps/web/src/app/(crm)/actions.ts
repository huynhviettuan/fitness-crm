"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { setOwnLocale } from "@/lib/api/users";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/api/notifications";

export async function setLocaleAction(locale: string): Promise<ActionResult> {
  return runAction(async () => {
    await setOwnLocale(locale);
  });
}

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await markNotificationRead(id);
  });
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  return runAction(async () => {
    await markAllNotificationsRead();
  });
}
