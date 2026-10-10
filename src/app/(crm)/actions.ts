"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { requireActionUser } from "@/lib/auth/current-user";
import { setOwnLocale } from "@/modules/users/user.service";

export async function setLocaleAction(locale: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireActionUser();
    await setOwnLocale(user, { locale });
  });
}
