import type { APIRequestContext } from "@playwright/test";

/**
 * Approves the pending request about `entityId` (and `action`) as `approver` (D-018), through the
 * same inbox endpoint a person uses. The approver must not be the submitter.
 */
export async function approvePendingViaApi(
  approver: APIRequestContext,
  entityId: string,
  action?: string,
): Promise<void> {
  const inbox = await approver.get("/api/v1/approvals?view=toDecide&pageSize=100");
  if (!inbox.ok()) throw new Error(`Approvals inbox: ${inbox.status()}`);
  const { items } = (await inbox.json()) as { items: { id: string; entityId: string; action: string }[] };
  // A record can have several requests (its creation, then its deletion): `action` picks one.
  const request = items.find((item) => item.entityId === entityId && (!action || item.action === action));
  if (!request) throw new Error(`No pending request for ${entityId}`);
  const response = await approver.post(`/api/v1/approvals/${request.id}/approve`);
  if (response.status() !== 204) throw new Error(`Approve failed: ${response.status()} ${await response.text()}`);
}
