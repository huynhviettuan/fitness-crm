"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { createIntakeSource, rotateIntakeSourceKey, setIntakePageToken, updateIntakeSource } from "@/lib/api/intake";
import type { IntakeSourceInput, IntakeSourceUpdate } from "@gymcrm/shared/intake";

// The writes of the lead sources (M10.1, D-044).

/** What is shown once after a source is made or re-keyed: a website key, or the WhatsApp verify token and where to post. */
export type Shown = { key: string | null; verifyToken: string | null; webhookPath: string | null };

export async function createSourceAction(input: IntakeSourceInput): Promise<ActionResult<Shown>> {
  return runAction(async () => {
    const created = await createIntakeSource(input);
    return { key: created.key, verifyToken: created.verifyToken, webhookPath: created.source.webhookPath };
  });
}

export async function updateSourceAction(id: string, input: IntakeSourceUpdate): Promise<ActionResult> {
  return runAction(async () => {
    await updateIntakeSource(id, input);
  });
}

export async function rotateSourceKeyAction(id: string): Promise<ActionResult<Shown>> {
  return runAction(async () => {
    const rotated = await rotateIntakeSourceKey(id);
    return { key: rotated.key, verifyToken: rotated.verifyToken, webhookPath: rotated.source.webhookPath };
  });
}

export async function setPageTokenAction(id: string, pageToken: string): Promise<ActionResult> {
  return runAction(async () => {
    await setIntakePageToken(id, pageToken);
  });
}
