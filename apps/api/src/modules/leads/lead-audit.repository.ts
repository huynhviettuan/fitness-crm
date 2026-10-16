import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

const person = { select: { id: true, name: true } } as const;

/** What the audit reads of a lead: its fields and the timing of its steps (A-081, A-083). */
const auditInclude = {
  pic: person,
  branch: { select: { id: true, name: true } },
  // Whether a manager has audited the person yet (A-088).
  consultingAudits: { select: { id: true }, take: 1 },
  leadSteps: {
    select: {
      dueAt: true,
      doneAt: true,
      timing: true,
      lockedAt: true,
      template: { select: { key: true, labelVi: true, labelEn: true, required: true, sortOrder: true } },
    },
  },
} as const;
export type AuditedPerson = Prisma.CustomerGetPayload<{ include: typeof auditInclude }>;

export function auditedPeople(db: Db, where: Prisma.CustomerWhereInput): Promise<AuditedPerson[]> {
  return db.customer.findMany({ where, include: auditInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
}

export function findAuditedPerson(db: Db, where: Prisma.CustomerWhereInput): Promise<AuditedPerson | null> {
  return db.customer.findFirst({ where, include: auditInclude });
}

export function listCriteria(db: Db) {
  return db.auditCriterion.findMany({ orderBy: { key: "asc" } });
}

export function updateCriterion(db: Db, key: string, data: { active: boolean; weight: number }) {
  return db.auditCriterion.update({ where: { key }, data });
}
