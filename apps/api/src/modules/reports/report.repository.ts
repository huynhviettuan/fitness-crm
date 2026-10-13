import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { chosenSelect } from "../../platform/options/option.service.js";

const person = { select: { id: true, name: true } } as const;

/** What the consulting reports read of a person: the profile and the history behind the funnel (A-089 to A-092). */
const reportInclude = {
  pic: person,
  channel: { select: chosenSelect },
  source: { select: chosenSelect },
  needGroup: { select: chosenSelect },
  refuseReason: { select: chosenSelect },
  leadStatusChanges: { select: { toStatus: true, changedAt: true } },
  leadAssignments: { select: { assignedAt: true }, orderBy: { assignedAt: "asc" }, take: 1 },
  leadSteps: {
    select: {
      dueAt: true,
      doneAt: true,
      timing: true,
      lockedAt: true,
      template: { select: { key: true, labelVi: true, labelEn: true, sortOrder: true } },
    },
  },
  // An approved contract is an active one (A-089).
  contracts: { where: { status: "ACTIVE", deletedAt: null }, select: { id: true }, take: 1 },
} satisfies Prisma.CustomerInclude;
export type ReportPerson = Prisma.CustomerGetPayload<{ include: typeof reportInclude }>;

/** The leads the system moved on, per consultant they were taken from, in a period (D-052). */
export async function reclaimedFrom(
  db: Db,
  where: { period: { gte?: Date; lt?: Date }; leads: Prisma.CustomerWhereInput; staffId?: string },
): Promise<{ user: { id: string; name: string }; count: number }[]> {
  const groups = await db.leadAssignment.groupBy({
    by: ["fromUserId"],
    where: {
      kind: "RECLAIM",
      assignedAt: where.period,
      customer: where.leads,
      fromUserId: where.staffId ? where.staffId : { not: null },
    },
    _count: { _all: true },
  });
  const users = await db.user.findMany({
    where: { id: { in: groups.flatMap((group) => (group.fromUserId ? [group.fromUserId] : [])) } },
    select: { id: true, name: true },
  });
  return groups.flatMap((group) => {
    const user = users.find((candidate) => candidate.id === group.fromUserId);
    return user ? [{ user, count: group._count._all }] : [];
  });
}

export function reportPeople(db: Db, where: Prisma.CustomerWhereInput): Promise<ReportPerson[]> {
  return db.customer.findMany({ where, include: reportInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
