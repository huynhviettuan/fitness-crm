import type { Response } from "express";
import { submittedSchema } from "@gymcrm/shared/approvals";
import { encode } from "./encode.js";

/** 202 with the approval request it created, or 204 when the change took effect (D-018). */
export function submittedOrDone(response: Response, submitted: { approval: { id: string } } | null) {
  if (!submitted) {
    response.status(204);
    return undefined;
  }
  response.status(202);
  return encode(submittedSchema, { approval: { id: submitted.approval.id, status: "PENDING" } });
}
