"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { setOwnLocale } from "@/lib/api/users";

export async function setLocaleAction(locale: string): Promise<ActionResult> {
  return runAction(async () => {
    await setOwnLocale(locale);
  });
}
