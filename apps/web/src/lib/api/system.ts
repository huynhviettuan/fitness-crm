import "server-only";
import { systemStatusSchema } from "@gymcrm/shared/system";
import { api, read } from "./client";

/** The System status page (A-321): jobs, backups, the outbox and the check-in machines. */
export async function getSystemStatus() {
  return read(systemStatusSchema, (await api()).GET("/api/v1/system/status"));
}
