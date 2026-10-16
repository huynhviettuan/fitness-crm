"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { updateSessionStatus } from "@/lib/api/bookings";
import type { SessionStatusInput } from "@gymcrm/shared/bookings";

export async function updateSessionStatusAction(code: string, input: SessionStatusInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateSessionStatus(code, input);
  });
}
