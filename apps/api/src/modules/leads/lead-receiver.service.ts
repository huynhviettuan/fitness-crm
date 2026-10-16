import { z } from "zod";
import { leadReceiverInputSchema, type LeadReceiver } from "@gymcrm/shared/leads";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { isWithinAccessWindows } from "../../platform/auth/access-hours.js";
import type { Actor } from "../../platform/auth/session.js";
import { prisma } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { holding } from "../../platform/permissions/holders.js";
import { parseInput } from "../../platform/validation/parse.js";

// Who receives leads and their turn weight (D-050). Managers who reassign leads (`lead.assign`)
// switch a consultant's receiving on or off (leave, busy) and set their weight; every change is audited.

/** Active consultants of the actor's branches. */
function receiversOf(actor: Actor): Prisma.UserWhereInput {
  return {
    AND: [
      { status: "ACTIVE" },
      holding("lead.receive"),
      actor.branches === "ALL"
        ? {}
        : { OR: [{ allBranches: true }, { branches: { some: { branchId: { in: [...actor.branches] } } } }] },
    ],
  };
}

const select = {
  id: true,
  name: true,
  allBranches: true,
  receivesLeads: true,
  leadWeight: true,
  role: { select: { id: true, name: true } },
  branches: { select: { branch: { select: { id: true, name: true } } } },
  accessWindows: { select: { weekdays: true, startTime: true, endTime: true } },
  _count: { select: { leadsInCharge: { where: { stage: "LEAD", leadStatus: "CONSULTING", mergedIntoId: null } } } },
} as const satisfies Prisma.UserSelect;

type Row = Prisma.UserGetPayload<{ select: typeof select }>;

function view(row: Row, now: Date): LeadReceiver {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    allBranches: row.allBranches,
    branches: row.branches.map(({ branch }) => branch).sort((a, b) => a.name.localeCompare(b.name, "vi")),
    receivesLeads: row.receivesLeads,
    leadWeight: row.leadWeight,
    onDuty: isWithinAccessWindows(row.accessWindows, now, env.GYM_TIMEZONE),
    leadsInCharge: row._count.leadsInCharge,
  };
}

export async function listLeadReceivers(actor: Actor, now: Date = new Date()): Promise<{ items: LeadReceiver[] }> {
  assertCan(actor, "lead.assign");
  const rows = await prisma.user.findMany({ where: receiversOf(actor), select, orderBy: { name: "asc" } });
  return { items: rows.map((row) => view(row, now)) };
}

export async function setLeadReceiver(actor: Actor, userId: string, input: unknown): Promise<LeadReceiver> {
  assertCan(actor, "lead.assign");
  const data = parseInput(leadReceiverInputSchema, input);
  if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findFirst({ where: { AND: [{ id: userId }, receiversOf(actor)] }, select });
    if (!before) throw new AppError("NOT_FOUND");
    const after = await tx.user.update({
      where: { id: userId },
      data: { receivesLeads: data.receivesLeads, leadWeight: data.leadWeight },
      select,
    });
    if (before.receivesLeads !== after.receivesLeads || before.leadWeight !== after.leadWeight) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "user",
        entityId: userId,
        action: "user.lead_reception_changed",
        before: { receivesLeads: before.receivesLeads, leadWeight: before.leadWeight },
        after: { receivesLeads: after.receivesLeads, leadWeight: after.leadWeight },
      });
    }
    return view(after, new Date());
  });
}
