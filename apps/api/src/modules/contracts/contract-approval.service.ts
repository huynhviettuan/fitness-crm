import type { Actor } from "../../platform/auth/session.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { approveRequest, rejectRequest } from "../approvals/approval.service.js";
import { getContract, pendingApprovalOf, type ContractView } from "./contract.service.js";

// Approving and rejecting a contract from its own page (A-120, A-121). The decision is the approval engine's: the
// matrix decides who may, nobody decides their own contract, and the inbox shows the same request. These two only find
// the contract's waiting request.

/**
 * Approves the contract's waiting request. Repeating an approval that already happened returns the current state
 * (docs/07), also when two approvers act at once.
 */
export async function activateContract(actor: Actor, id: string): Promise<ContractView> {
  assertCan(actor, "contract.approve");
  return decideFromPage(actor, id, (requestId) => approveRequest(actor, requestId));
}

/** Rejects the contract's waiting request with a reason from the `rejectReasons` list. */
export async function rejectContract(actor: Actor, id: string, input: unknown): Promise<ContractView> {
  assertCan(actor, "contract.approve");
  return decideFromPage(actor, id, (requestId) => rejectRequest(actor, requestId, input));
}

async function decideFromPage(
  actor: Actor,
  id: string,
  decide: (requestId: string) => Promise<void>,
): Promise<ContractView> {
  const { requestId, contract } = await pendingApprovalOf(actor, id);
  if (!requestId) {
    if (contract.status === "ACTIVE") return contract;
    throw new AppError("INVALID_STATUS_TRANSITION");
  }
  try {
    await decide(requestId);
  } catch (error) {
    // The other approver was first: the contract is as they left it.
    if (error instanceof AppError && error.code === "APPROVAL_NOT_PENDING") {
      const now = await getContract(actor, id);
      if (now.status === "ACTIVE") return now;
    }
    throw error;
  }
  return getContract(actor, id);
}
