import type { Db } from "../../platform/db/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { formatLeadCode } from "@flow/shared/leads";
import { normalizeForSearch, normalizePhone } from "@flow/shared/validation";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { chosenSelect } from "../../platform/options/option.service.js";

const withRefs = {
  branch: { select: { id: true, name: true } },
  channel: { select: chosenSelect },
  source: { select: chosenSelect },
  needGroup: { select: chosenSelect },
  painStatus: { select: chosenSelect },
  assessmentType: { select: chosenSelect },
  pic: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const satisfies Prisma.CustomerInclude;

export type LeadRecord = Prisma.CustomerGetPayload<{ include: typeof withRefs }>;

/** The stored lead profile (brief §4.1). */
export type LeadWrite = {
  fullName: string;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  dateOfBirth: Date | null;
  phone: string | null;
  email: string | null;
  channelId: string;
  channelNote: string | null;
  sourceId: string | null;
  sourceNote: string | null;
  sourceType: "ORGANIC" | "PAID" | null;
  sourceDetail: string | null;
  nationalityGroup: "VIETNAM" | "FOREIGN" | null;
  needGroupId: string | null;
  needGroupNote: string | null;
  needDetail: string | null;
  painStatusId: string | null;
  painStatusNote: string | null;
  assessmentTypeId: string | null;
  assessmentTypeNote: string | null;
  notes: string | null;
};

/** Draws the next lead code; concurrent callers never get the same value (D-038). */
export async function nextLeadCode(db: Db): Promise<string> {
  const [row] = await db.$queryRaw<{ value: bigint }[]>`SELECT nextval('lead_code_seq') AS value`;
  return formatLeadCode(await readParameter(db, "leadCodePrefix"), row.value);
}

/** A new lead: stage LEAD, status NEW, nobody in charge yet (D-020). */
export function createLead(db: Db, leadCode: string, data: LeadWrite & { branchId: string; createdById: string }): Promise<LeadRecord> {
  return db.customer.create({
    data: { ...data, leadCode, stage: "LEAD", leadStatus: "NEW", searchName: normalizeForSearch(data.fullName) },
    include: withRefs,
  });
}

export function updateLead(db: Db, id: string, data: LeadWrite): Promise<LeadRecord> {
  return db.customer.update({ where: { id }, data: { ...data, searchName: normalizeForSearch(data.fullName) }, include: withRefs });
}

export function findLead(db: Db, id: string, visibility: Prisma.CustomerWhereInput): Promise<LeadRecord | null> {
  return db.customer.findFirst({ where: { AND: [{ id }, visibility] }, include: withRefs });
}

export async function listLeads(
  db: Db,
  where: Prisma.CustomerWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: LeadRecord[]; total: number }> {
  const [items, total] = await Promise.all([
    db.customer.findMany({ where, include: withRefs, orderBy: [{ createdAt: "desc" }, { leadCode: "desc" }], ...page }),
    db.customer.count({ where }),
  ]);
  return { items, total };
}

/** Search by lead code, name without diacritics, or phone digits (unless the phone is hidden). */
export function searchWhere(q: string, searchPhone: boolean): Prisma.CustomerWhereInput {
  const term = q.trim();
  if (!term) return {};
  const phoneTerm = normalizePhone(term);
  return {
    OR: [
      { leadCode: { contains: term, mode: "insensitive" } },
      { searchName: { contains: normalizeForSearch(term) } },
      ...(searchPhone && /^\+?\d+$/.test(phoneTerm) ? [{ phone: { contains: phoneTerm } }] : []),
    ],
  };
}
