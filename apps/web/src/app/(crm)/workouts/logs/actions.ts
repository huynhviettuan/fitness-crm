"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { openLog, updateLog } from "@/lib/api/workout-logs";
import type { LogContentInput } from "@gymcrm/shared/workouts";

// The writes of the session log (M7.3): opening answers the log's id so the screen can go to it.

export async function openLogAction(bookingId: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => ({ id: (await openLog(bookingId)).id }));
}

export async function saveLogAction(id: string, input: LogContentInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateLog(id, input);
  });
}
