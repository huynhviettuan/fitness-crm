"use server";

import { runAction, type ActionResult } from "@/lib/actions/result";
import { updateEmailTemplate } from "@/lib/api/mail";
import type { EmailTemplateInput } from "@flow/shared/mail";

export async function updateEmailTemplateAction(event: string, input: EmailTemplateInput): Promise<ActionResult> {
  return runAction(async () => {
    await updateEmailTemplate(event, input);
  });
}
