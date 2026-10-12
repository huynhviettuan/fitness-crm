import { z } from "zod";
import {
  auditLeadsQuerySchema,
  managerAuditInputSchema,
  type ManagerAudit,
  type UnauditedLeadsPage,
} from "@flow/shared/leads";
import { prisma } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { chosen } from "../../platform/options/option.service.js";
import { visiblePerson } from "./lead.present.js";
import { auditedWhere, createdIn } from "./lead-audit.service.js";
import * as repo from "./manager-audit.repository.js";

// The manager's audit of a lead (brief §4.1, FR-LEAD-011; A-086 to A-088): Pass or Fail with a
// comment and the criteria not met. Append-only; the latest grade counts.

function view(audit: repo.ManagerAuditRecord): ManagerAudit {
  return {
    id: audit.id,
    result: audit.result,
    comment: audit.comment,
    criteria: audit.criteria.map((criterion) => chosen(criterion.option, null)),
    auditor: audit.auditor,
    at: audit.createdAt,
  };
}

/** Every grade of a lead or customer the actor may see, newest first (A-086). */
export async function managerAudits(actor: Actor, id: string): Promise<ManagerAudit[]> {
  assertCan(actor, "lead.view");
  const person = await visiblePerson(prisma, actor, id);
  return (await repo.auditsOf(prisma, person.id)).map(view);
}

/** A manager grades a lead; each grade is kept and the latest counts (A-086, A-087). */
export async function addManagerAudit(actor: Actor, id: string, rawInput: unknown): Promise<ManagerAudit> {
  assertCan(actor, "lead.audit");
  const input = parseInput(managerAuditInputSchema, rawInput);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const person = await tx.customer.findFirst({
      where: auditedWhere(actor, [{ id }]),
      select: { id: true, stage: true },
    });
    if (!person) throw new AppError("NOT_FOUND");
    // The criteria are active options of their list; "Khác" needs the comment (D-016).
    const options = await tx.option.findMany({
      where: { id: { in: input.criterionIds }, listKey: "auditFailReasons", active: true },
      select: { id: true, isOther: true },
    });
    if (options.length !== input.criterionIds.length) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { criterionIds: ["invalidChoice"] } });
    }
    if (options.some((option) => option.isOther) && !input.comment) {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { comment: ["otherNeedsNote"] } });
    }
    const audit = await repo.createAudit(tx, {
      personId: person.id,
      result: input.result,
      comment: input.comment,
      auditorId: actor.id,
      criterionIds: input.criterionIds,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: person.stage === "LEAD" ? "lead" : "customer",
      entityId: person.id,
      action: "lead.audited",
      // The comment stays on the audit; the history says that there was one.
      after: {
        auditId: audit.id,
        result: audit.result,
        criterionIds: input.criterionIds,
        commented: input.comment !== null,
      },
    });
    return view(audit);
  });
}

/** "Chưa audit": people nobody has audited, oldest first, in the actor's scope (A-088). */
export async function auditQueue(actor: Actor, rawQuery: unknown): Promise<UnauditedLeadsPage> {
  assertCan(actor, "lead.audit");
  const query = parseInput(auditLeadsQuerySchema, rawQuery);
  const { items, total } = await repo.unaudited(
    prisma,
    auditedWhere(actor, [
      createdIn(query),
      query.consultantId ? { picUserId: query.consultantId } : {},
      { consultingAudits: { none: {} } },
    ]),
    (query.page - 1) * query.pageSize,
    query.pageSize,
  );
  return {
    items: items.map((person) => ({
      id: person.id,
      leadCode: person.leadCode ?? "",
      fullName: person.fullName,
      status: person.leadStatus ?? "NEW",
      pic: person.pic,
      branch: person.branch,
      createdAt: person.createdAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
