import "server-only";
import { leadReceiverListSchema, leadReceiverSchema, type LeadReceiverInput } from "@gymcrm/shared/leads";
import { api, read } from "./client";

// Who receives leads and their turn weight (D-050).

export async function listLeadReceivers() {
  const { items } = await read(leadReceiverListSchema, (await api()).GET("/api/v1/lead-receivers"));
  return items;
}

export async function setLeadReceiver(userId: string, input: LeadReceiverInput) {
  return read(
    leadReceiverSchema,
    (await api()).PUT("/api/v1/lead-receivers/{userId}", { params: { path: { userId } }, body: input as never }),
  );
}
