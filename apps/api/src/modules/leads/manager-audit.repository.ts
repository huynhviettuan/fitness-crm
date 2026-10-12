import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { chosenSelect } from "../../platform/options/option.service.js";

const person = { select: { id: true, name: true } } as const;

const auditInclude = {
  auditor: person,
  criteria: { include: { option: { select: chosenSelect } } },
} as const;
export type ManagerAuditRecord = Prisma.ConsultingAuditGetPayload<{ include: typeof auditInclude }>;

/** Every grade of a person, newest first: the first counts (A-086). */
export function auditsOf(db: Db, personId: string): Promise<ManagerAuditRecord[]> {
  return db.consultingAudit.findMany({
    where: { personId },
    include: auditInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

export function createAudit(
  db: Db,
  data: {
    personId: string;
    result: "PASS" | "FAIL";
    comment: string | null;
    auditorId: string;
    criterionIds: string[];
  },
): Promise<ManagerAuditRecord> {
  const { criterionIds, ...rest } = data;
  return db.consultingAudit.create({
    data: { ...rest, criteria: { create: criterionIds.map((optionId) => ({ optionId })) } },
    include: auditInclude,
  });
}

const queueInclude = { pic: person, branch: { select: { id: true, name: true } } } as const;

/** The people nobody has audited, oldest first (A-088). */
export async function unaudited(db: Db, where: Prisma.CustomerWhereInput, skip: number, take: number) {
  const [items, total] = await Promise.all([
    db.customer.findMany({
      where,
      include: queueInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip,
      take,
    }),
    db.customer.count({ where }),
  ]);
  return { items, total };
}
