import { z } from "zod";
import { rejectSchema, type ApprovalAction } from "@flow/shared/approvals";
import type { ChosenOption } from "@flow/shared/options";
import type { ApprovalRequest as RequestRow } from "../../generated/prisma/client.js";
import { mayDecide, ruleFor } from "../../platform/approvals/approval.engine.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import type { Actor } from "../../platform/auth/session.js";
import { LOCKING_TRANSACTION, prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { hasBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";
import { lockContract } from "../contracts/contract.repository.js";
import { applyIdentityChange } from "../customers/customer.service.js";
import { applyCashDeletion, decideCashTransaction, findCashForApproval } from "../finance/cash.service.js";
import { applyPaymentDeletion, decidePayment, findPaymentForApproval } from "../finance/payment.service.js";

// Deciding approval requests (D-018, FR-PLT-007). The engine (platform/approvals)
// knows the matrix and who may decide; this module knows what approving each action
// does. A decision runs in one transaction: locks in the usual order (contract first,
// T-040), the request row, then the change.

type Handler = {
  /** Locks to take before the request row, in the lock order. */
  lock?: (tx: Db, request: RequestRow) => Promise<void>;
  approve: (tx: Db, request: RequestRow, decider: Actor) => Promise<void>;
  reject?: (tx: Db, request: RequestRow, decider: Actor) => Promise<void>;
};

const lockPaymentContract = async (tx: Db, request: RequestRow) => {
  const payment = await findPaymentForApproval(tx, request.entityId);
  if (payment) await lockContract(tx, payment.contractId);
};

const HANDLERS: Record<ApprovalAction, Handler> = {
  "payment.create": {
    lock: lockPaymentContract,
    approve: (tx, request, decider) => decidePayment(tx, decider, request.entityId, "APPROVED"),
    reject: (tx, request, decider) => decidePayment(tx, decider, request.entityId, "REJECTED"),
  },
  "cash.create": {
    approve: (tx, request, decider) => decideCashTransaction(tx, decider, request.entityId, "APPROVED"),
    reject: (tx, request, decider) => decideCashTransaction(tx, decider, request.entityId, "REJECTED"),
  },
  "record.delete": {
    lock: async (tx, request) => {
      if (request.entityType === "payment") await lockPaymentContract(tx, request);
    },
    // The record is deleted by whoever asked; the approver is in the request and audit.
    approve: async (tx, request) => {
      const reason = (request.payload as { reason: ChosenOption }).reason;
      const deleter = { id: request.submittedById };
      const chosen = { optionId: reason.id, note: reason.note };
      if (request.entityType === "payment") {
        const payment = await findPaymentForApproval(tx, request.entityId);
        if (!payment) throw new AppError("NOT_FOUND");
        await applyPaymentDeletion(tx, payment, deleter, chosen);
      } else {
        const transaction = await findCashForApproval(tx, request.entityId);
        if (!transaction) throw new AppError("NOT_FOUND");
        await applyCashDeletion(tx, transaction, deleter, chosen);
      }
    },
  },
  "customer.identity": {
    approve: (tx, request, decider) =>
      applyIdentityChange(tx, decider, request.entityId, request.payload as { fullName?: string; phone?: string; email?: string | null }, request.id),
  },
};

export async function approveRequest(actor: Actor, id: string): Promise<void> {
  await decide(actor, id, { status: "APPROVED" });
}

/** Rejecting needs a reason from the "rejectReasons" list ("Khác" with a note). */
export async function rejectRequest(actor: Actor, id: string, input: unknown): Promise<void> {
  const { reasonId, reasonNote } = parseInput(rejectSchema, input);
  await decide(actor, id, { status: "REJECTED", reason: { optionId: reasonId, note: reasonNote } });
}

async function decide(
  actor: Actor,
  id: string,
  decision: { status: "APPROVED" } | { status: "REJECTED"; reason: { optionId: string; note: string | null } },
): Promise<void> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({ where: { id } });
    // Requests of other branches are not found (D-014).
    if (!request || !hasBranch(actor, request.branchId)) throw new AppError("NOT_FOUND");
    const handler = HANDLERS[request.actionType as ApprovalAction];
    if (!handler) throw new AppError("NOT_FOUND");
    await handler.lock?.(tx, request);
    // One decision per request, also when two approvers act at once.
    const [row] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM approval_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (row.status !== "PENDING") throw new AppError("APPROVAL_NOT_PENDING");
    if (request.submittedById === actor.id) throw new AppError("APPROVAL_OWN_REQUEST");
    if (!mayDecide(actor, request, await ruleFor(tx, request.actionType as ApprovalAction))) throw new AppError("FORBIDDEN");

    const reason =
      decision.status === "REJECTED" ? await resolveChoice(tx, "rejectReasons", "reasonId", { optionId: decision.reason.optionId, note: decision.reason.note }) : null;
    // The request is decided first, so the change can withdraw any other pending
    // request of the record without touching this one.
    await tx.approvalRequest.update({
      where: { id },
      data: {
        status: decision.status,
        decidedById: actor.id,
        decidedAt: new Date(),
        rejectReasonId: reason?.optionId ?? null,
        rejectReasonNote: reason?.note ?? null,
      },
    });
    if (decision.status === "APPROVED") await handler.approve(tx, request, actor);
    else await handler.reject?.(tx, request, actor);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "approval_request",
      entityId: id,
      action: decision.status === "APPROVED" ? "approval_request.approved" : "approval_request.rejected",
      before: { status: "PENDING" },
      after: { status: decision.status },
      context: { action: request.actionType, entityType: request.entityType, entityId: request.entityId, ...(reason ? { reason } : {}) },
    });
    await notify(tx, [request.submittedById], {
      kind: "approvalDecided",
      params: { title: request.title, status: decision.status },
      link: "/approvals?view=mine",
    });
  }, LOCKING_TRANSACTION);
}
