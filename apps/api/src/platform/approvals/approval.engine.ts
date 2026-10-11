import {
  APPROVAL_ACTIONS,
  approvalRuleInputSchema,
  listApprovalsSchema,
  type ApprovalAction,
  type ApprovalRequest,
  type ApprovalRule,
} from "@flow/shared/approvals";
import type { ApprovalStatus, Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../audit/audit.repository.js";
import type { Actor } from "../auth/session.js";
import { isUniqueViolation } from "../db/errors.js";
import { prisma, type Db } from "../db/prisma.js";
import { AppError } from "../errors/app-error.js";
import { activeInBranch, notify } from "../notifications/notification.service.js";
import { chosen, chosenSelect } from "../options/option.service.js";
import { assertCan } from "../permissions/assert.js";
import { hasBranch, inBranches, isMasked } from "../permissions/scope.js";
import { parseInput } from "../validation/parse.js";

// The approval engine (D-018): the matrix, submitting a request, and who may decide.
// Deciding lives in modules/approvals, which knows what approving each action does.

export type Rule = { required: boolean; approverRoleIds: string[]; overdueHours: number };

/** The rule of an action; an action without a row needs no approval. */
export async function ruleFor(db: Db, action: ApprovalAction): Promise<Rule> {
  const row = await db.approvalRule.findUnique({
    where: { actionType: action },
    include: { approvers: { select: { roleId: true } } },
  });
  if (!row) return { required: false, approverRoleIds: [], overdueHours: 24 };
  return {
    required: row.required,
    approverRoleIds: row.approvers.map((a) => a.roleId),
    overdueHours: row.overdueHours,
  };
}

export type Submission = {
  action: ApprovalAction;
  entityType: string;
  entityId: string;
  branchId: string;
  title: string;
  amount: number | null;
  /** What approving applies, e.g. a customer's new phone or a deletion's reason. */
  payload?: Prisma.InputJsonValue;
};

/**
 * Records a pending request, in the transaction of the submitted change. A second
 * pending request for the same record and action is refused (APPROVAL_ALREADY_PENDING).
 */
export async function submitForApproval(
  db: Db,
  actor: Pick<Actor, "id">,
  submission: Submission,
): Promise<{ id: string }> {
  const request = await db.approvalRequest.create({
    data: {
      actionType: submission.action,
      entityType: submission.entityType,
      entityId: submission.entityId,
      branchId: submission.branchId,
      title: submission.title,
      amount: submission.amount,
      payload: submission.payload ?? {},
      submittedById: actor.id,
    },
    select: { id: true },
  });
  await recordAudit(db, {
    actorUserId: actor.id,
    entityType: "approval_request",
    entityId: request.id,
    action: "approval_request.submitted",
    after: {
      action: submission.action,
      entityType: submission.entityType,
      entityId: submission.entityId,
      status: "PENDING",
    },
  });
  // D-018: the approvers get it in their inbox, and are told.
  const deciders = await decidersOf(db, {
    actionType: submission.action,
    branchId: submission.branchId,
    submittedById: actor.id,
  });
  await notify(db, deciders, { kind: "approvalSubmitted", params: { title: submission.title }, link: "/approvals" });
  return request;
}

type RequestRef = { actionType: string; branchId: string; submittedById: string };

/** Active users who may decide a request: their role approves the action, they work in its branch, they did not submit it. */
export async function decidersOf(db: Db, request: RequestRef): Promise<string[]> {
  const rule = await ruleFor(db, request.actionType as ApprovalAction);
  if (rule.approverRoleIds.length === 0) return [];
  return usersWhere(db, request, { roleId: { in: rule.approverRoleIds } });
}

/**
 * The approvers' superiors, told when a request is overdue (D-018). Until the business
 * names them (OQ-031), they are the users whose role manages the approval matrix (A-047).
 */
export async function superiorsOf(db: Db, request: RequestRef): Promise<string[]> {
  return usersWhere(db, request, { role: { permissions: { some: { permission: "approval.manage" } } } });
}

async function usersWhere(db: Db, request: RequestRef, where: Prisma.UserWhereInput): Promise<string[]> {
  const users = await db.user.findMany({
    where: { AND: [activeInBranch(request.branchId), where, { id: { not: request.submittedById } }] },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/**
 * A-037: once a pending request passes its action's overdue time, its approvers are
 * reminded and their superiors told, once. Run by the worker (T-059).
 */
export async function remindOverdueApprovals(now: Date = new Date()): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const overdue = await tx.$queryRaw<
      { id: string; action_type: string; branch_id: string; submitted_by: string; title: string }[]
    >`
      UPDATE approval_requests AS ar SET overdue_notified_at = ${now}
      FROM approval_rules AS r
      WHERE r.action_type = ar.action_type
        AND ar.status = 'PENDING'
        AND ar.overdue_notified_at IS NULL
        AND ar.submitted_at + make_interval(hours => r.overdue_hours) <= ${now}
      RETURNING ar.id, ar.action_type, ar.branch_id, ar.submitted_by, ar.title`;
    for (const row of overdue) {
      const request = { actionType: row.action_type, branchId: row.branch_id, submittedById: row.submitted_by };
      const users = [...(await decidersOf(tx, request)), ...(await superiorsOf(tx, request))];
      await notify(tx, users, { kind: "approvalOverdue", params: { title: row.title }, link: "/approvals" });
    }
    return overdue.length;
  });
}

/** Maps the one-pending-request index to its error; use around a submitting transaction. */
export async function withPendingConflictMapped<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("APPROVAL_ALREADY_PENDING");
    throw error;
  }
}

/** True when a request for this record and action is waiting. */
export async function hasPending(db: Db, action: ApprovalAction, entityId: string): Promise<boolean> {
  return (await db.approvalRequest.count({ where: { actionType: action, entityId, status: "PENDING" } })) > 0;
}

/** When a record goes away, its pending requests are withdrawn (no decider). */
export async function cancelPendingFor(db: Db, entityId: string): Promise<void> {
  await db.approvalRequest.updateMany({
    where: { entityId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
}

/**
 * D-018: an approver of the action's current rule, with the request's branch, and not
 * the submitter. Matrix changes take effect for requests already pending.
 */
export function mayDecide(
  actor: Pick<Actor, "id" | "roleId" | "branches">,
  request: { submittedById: string; branchId: string },
  rule: Rule,
): boolean {
  return (
    actor.id !== request.submittedById &&
    rule.approverRoleIds.includes(actor.roleId) &&
    hasBranch(actor, request.branchId)
  );
}

// ---------------------------------------------------------------------------
// The matrix (FR-PLT-006): one rule per action.
// ---------------------------------------------------------------------------

export async function listRules(actor: Actor): Promise<ApprovalRule[]> {
  assertCan(actor, "approval.manage");
  const rows = await prisma.approvalRule.findMany({
    include: { approvers: { include: { role: { select: { id: true, name: true } } } } },
  });
  return APPROVAL_ACTIONS.map((action) => {
    const row = rows.find((r) => r.actionType === action);
    return {
      action,
      required: row?.required ?? false,
      approvers: (row?.approvers ?? []).map((a) => a.role).sort((a, b) => a.name.localeCompare(b.name)),
      overdueHours: row?.overdueHours ?? 24,
    };
  });
}

/** All fields are sent; audited with old and new values. */
export async function updateRule(actor: Actor, rawAction: string, input: unknown): Promise<ApprovalRule> {
  assertCan(actor, "approval.manage");
  const action = APPROVAL_ACTIONS.find((a) => a === rawAction);
  if (!action) throw new AppError("NOT_FOUND");
  const data = parseInput(approvalRuleInputSchema, input);
  const roleIds = [...new Set(data.approverRoleIds)];
  if ((await prisma.role.count({ where: { id: { in: roleIds } } })) !== roleIds.length) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { approverRoleIds: ["invalidChoice"] } });
  }
  await prisma.$transaction(async (tx) => {
    const before = await ruleFor(tx, action);
    const rule = await tx.approvalRule.upsert({
      where: { actionType: action },
      create: { actionType: action, required: data.required, overdueHours: data.overdueHours },
      update: { required: data.required, overdueHours: data.overdueHours },
      select: { id: true },
    });
    await tx.approvalRuleRole.deleteMany({ where: { actionType: action } });
    await tx.approvalRuleRole.createMany({ data: roleIds.map((roleId) => ({ actionType: action, roleId })) });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "approval_rule",
      entityId: rule.id,
      action: "approval_rule.updated",
      before: {
        required: before.required,
        overdueHours: before.overdueHours,
        approverRoleIds: [...before.approverRoleIds].sort(),
      },
      after: { required: data.required, overdueHours: data.overdueHours, approverRoleIds: [...roleIds].sort() },
      context: { action },
    });
  });
  return (await listRules(actor)).find((rule) => rule.action === action)!;
}

// ---------------------------------------------------------------------------
// The inbox (FR-PLT-007).
// ---------------------------------------------------------------------------

const requestInclude = {
  branch: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  rejectReason: { select: chosenSelect },
} as const satisfies Prisma.ApprovalRequestInclude;

type RequestRow = Prisma.ApprovalRequestGetPayload<{ include: typeof requestInclude }>;

export async function listApprovals(
  actor: Actor,
  rawQuery: unknown,
): Promise<{ items: ApprovalRequest[]; total: number; page: number; pageSize: number }> {
  const query = parseInput(listApprovalsSchema, rawQuery);
  const rules = await allRules();
  let where: Prisma.ApprovalRequestWhereInput;
  if (query.view === "mine") {
    where = { submittedById: actor.id, status: query.status };
  } else if (query.view === "all") {
    assertCan(actor, "approval.manage");
    where = { AND: [inBranches(actor), { status: query.status }] };
  } else {
    // What the actor may decide: actions whose approvers include their role.
    const actions = [...rules]
      .filter(([, rule]) => rule.approverRoleIds.includes(actor.roleId))
      .map(([action]) => action);
    where = {
      AND: [
        inBranches(actor),
        { actionType: { in: actions }, submittedById: { not: actor.id }, status: query.status ?? "PENDING" },
      ],
    };
  }
  const [rows, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      include: requestInclude,
      orderBy: { submittedAt: query.view === "toDecide" ? "asc" : "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.approvalRequest.count({ where }),
  ]);
  return { items: rows.map((row) => toView(actor, row, rules)), total, page: query.page, pageSize: query.pageSize };
}

/** For the top bar: what waits for the actor, and how much of it is overdue. */
export async function approvalSummary(actor: Actor): Promise<{ toDecide: number; overdue: number }> {
  const rules = await allRules();
  const now = Date.now();
  const mine = [...rules].filter(([, rule]) => rule.approverRoleIds.includes(actor.roleId));
  if (mine.length === 0) return { toDecide: 0, overdue: 0 };
  const rows = await prisma.approvalRequest.findMany({
    where: {
      AND: [
        inBranches(actor),
        { actionType: { in: mine.map(([a]) => a) }, submittedById: { not: actor.id }, status: "PENDING" },
      ],
    },
    select: { actionType: true, submittedAt: true },
  });
  const overdue = rows.filter(
    (row) => now - row.submittedAt.getTime() > rules.get(row.actionType as ApprovalAction)!.overdueHours * 3_600_000,
  );
  return { toDecide: rows.length, overdue: overdue.length };
}

async function allRules(): Promise<Map<ApprovalAction, Rule>> {
  return new Map(
    await Promise.all(APPROVAL_ACTIONS.map(async (action) => [action, await ruleFor(prisma, action)] as const)),
  );
}

function toView(actor: Actor, row: RequestRow, rules: Map<ApprovalAction, Rule>): ApprovalRequest {
  const action = row.actionType as ApprovalAction;
  const rule = rules.get(action)!;
  const status = row.status as ApprovalStatus;
  const overdue = status === "PENDING" && Date.now() - row.submittedAt.getTime() > rule.overdueHours * 3_600_000;
  return {
    id: row.id,
    action,
    entityType: row.entityType,
    entityId: row.entityId,
    branch: row.branch,
    title: row.title,
    amount: row.amount === null || isMasked(actor, "receipts.totals") ? null : Number(row.amount),
    changes: maskChanges(actor, row.payload),
    status,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    rejectReason: row.rejectReason ? chosen(row.rejectReason, row.rejectReasonNote) : null,
    overdue,
    canDecide: status === "PENDING" && mayDecide(actor, row, rule),
  };
}

/** A customer's phone or email hidden from the role stays hidden in requests (D-017). */
function maskChanges(actor: Actor, payload: Prisma.JsonValue): Record<string, unknown> {
  const changes = { ...((payload ?? {}) as Record<string, unknown>) };
  if (isMasked(actor, "customer.phone")) delete changes.phone;
  if (isMasked(actor, "customer.email")) delete changes.email;
  return changes;
}
