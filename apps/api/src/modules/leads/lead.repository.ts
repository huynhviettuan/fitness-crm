import type { Db } from "../../platform/db/prisma.js";
import type { LeadStatus, Prisma } from "../../generated/prisma/client.js";
import { formatLeadCode } from "@gymcrm/shared/leads";
import { normalizeForSearch, normalizePhone } from "@gymcrm/shared/validation";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { chosenSelect } from "../../platform/options/option.service.js";
import { activeInBranch } from "../../platform/notifications/notification.service.js";
import { holding } from "../../platform/permissions/holders.js";

const withRefs = {
  branch: { select: { id: true, name: true } },
  channel: { select: chosenSelect },
  source: { select: chosenSelect },
  needGroup: { select: chosenSelect },
  needDetailOption: { select: chosenSelect },
  painStatus: { select: chosenSelect },
  assessmentType: { select: chosenSelect },
  refuseReason: { select: chosenSelect },
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
  countryCode: string | null;
  nationalityGroup: "VIETNAM" | "FOREIGN" | null;
  needGroupId: string | null;
  needGroupNote: string | null;
  needDetailId: string | null;
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
export function createLead(
  db: Db,
  leadCode: string,
  data: LeadWrite & { branchId: string; createdById: string },
  now: Date,
): Promise<LeadRecord> {
  return db.customer.create({
    data: {
      ...data,
      leadCode,
      stage: "LEAD",
      leadStatus: "NEW",
      leadStatusChangedAt: now,
      searchName: normalizeForSearch(data.fullName),
    },
    include: withRefs,
  });
}

/** Holds the lead until the transaction ends, so two changes of its journey never interleave. */
export async function lockLead(db: Db, id: string): Promise<void> {
  await db.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${id}::uuid FOR UPDATE`;
}

/** The journey's state on the lead (D-020); its history is in addStatusChange and addAssignment. */
export type JourneyWrite = {
  leadStatus?: LeadStatus;
  leadStatusChangedAt?: Date;
  appointmentAt?: Date | null;
  contactAgainOn?: Date | null;
  refuseReasonId?: string | null;
  refuseReasonNote?: string | null;
  picUserId?: string;
};

export function updateJourney(db: Db, id: string, data: JourneyWrite): Promise<LeadRecord> {
  return db.customer.update({ where: { id }, data, include: withRefs });
}

export async function addStatusChange(
  db: Db,
  data: {
    customerId: string;
    fromStatus: LeadStatus | null;
    toStatus: LeadStatus;
    changedById: string | null;
    changedAt: Date;
    appointmentAt?: Date | null;
    reasonId?: string | null;
    reasonNote?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await db.leadStatusChange.create({ data });
}

export async function addAssignment(
  db: Db,
  data: {
    customerId: string;
    fromUserId: string | null;
    toUserId: string;
    assignedById: string | null;
    assignedAt: Date;
    kind: "ROUND_ROBIN" | "MANUAL" | "RECLAIM";
    waitedMinutes?: number | null;
  },
): Promise<void> {
  await db.leadAssignment.create({ data });
}

const person = { select: { id: true, name: true } } as const;

/** The lead's status changes and assignments (D-020). */
export function timeline(db: Db, customerId: string) {
  return Promise.all([
    db.leadStatusChange.findMany({
      where: { customerId },
      include: { changedBy: person, reason: { select: chosenSelect } },
      orderBy: { changedAt: "desc" },
    }),
    db.leadAssignment.findMany({
      where: { customerId },
      include: { fromUser: person, toUser: person, assignedBy: person },
      orderBy: { assignedAt: "desc" },
    }),
  ]);
}

const noteInclude = { author: person } as const;
export type NoteRecord = Prisma.LeadNoteGetPayload<{ include: typeof noteInclude }>;

/** The notes of a person's record, newest first (A-074). */
export function notesOf(db: Db, personId: string): Promise<NoteRecord[]> {
  return db.leadNote.findMany({ where: { personId }, include: noteInclude, orderBy: { createdAt: "desc" } });
}

export function addNote(db: Db, data: { personId: string; body: string; createdBy: string }): Promise<NoteRecord> {
  return db.leadNote.create({ data, include: noteInclude });
}

/** Who may be given the branch's leads (BR-203): active users of the branch who receive leads, in round-robin order. */
export function receivers(db: Db, branchId: string): Promise<{ id: string; name: string; createdAt: Date }[]> {
  return db.user.findMany({
    where: { AND: [activeInBranch(branchId), holding("lead.receive")] },
    select: { id: true, name: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Who the round-robin may give the branch's leads to (D-050): the receivers whose switch is on,
 * with their turn weight and access windows (their working hours), in their fixed order.
 */
export function turnTakers(db: Db, branchId: string) {
  return db.user.findMany({
    where: { AND: [activeInBranch(branchId), holding("lead.receive"), { receivesLeads: true }] },
    select: {
      id: true,
      name: true,
      createdAt: true,
      leadWeight: true,
      accessWindows: { select: { weekdays: true, startTime: true, endTime: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Where the branch's consultants stand in the weighted round-robin: each one's virtual time, and the
 * highest of the branch (a newcomer starts level with it). A person never dealt a lead has no row.
 */
export async function turnState(
  db: Db,
  branchId: string,
  userIds: string[],
): Promise<{ vtimes: Map<string, bigint>; latest: bigint }> {
  const rows = await db.leadTurn.findMany({ where: { branchId } });
  const latest = rows.reduce((max, row) => (row.vtime > max ? row.vtime : max), 0n);
  return {
    vtimes: new Map(rows.filter((row) => userIds.includes(row.userId)).map((row) => [row.userId, row.vtime])),
    latest,
  };
}

export async function saveTurnTimes(db: Db, branchId: string, vtimes: Record<string, bigint>): Promise<void> {
  for (const [userId, vtime] of Object.entries(vtimes)) {
    await db.leadTurn.upsert({
      where: { branchId_userId: { branchId, userId } },
      create: { branchId, userId, vtime },
      update: { vtime },
    });
  }
}

/** Who should hear of the branch's new leads: active users of the branch who reassign them (brief §4.1). */
export async function leadManagers(db: Db, branchId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { AND: [activeInBranch(branchId), holding("lead.assign")] },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** Serializes the branch's round-robin; held until the transaction ends. */
export async function lockRoundRobin(db: Db, branchId: string): Promise<void> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead-round-robin:${branchId}`}))::text AS locked`;
}

/** One Kanban column (FR-LEAD-006): appointments soonest first, the rest longest in their status last. */
export async function boardColumn(
  db: Db,
  where: Prisma.CustomerWhereInput,
  status: LeadStatus,
  take: number,
): Promise<{ items: LeadRecord[]; total: number }> {
  const inStatus: Prisma.CustomerWhereInput = { AND: [where, { leadStatus: status }] };
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    status === "BOOKED"
      ? [{ appointmentAt: "asc" }, { leadCode: "asc" }]
      : [{ leadStatusChangedAt: "desc" }, { leadCode: "desc" }];
  const [items, total] = await Promise.all([
    db.customer.findMany({ where: inStatus, include: withRefs, orderBy, take }),
    db.customer.count({ where: inStatus }),
  ]);
  return { items, total };
}

export function updateLead(db: Db, id: string, data: LeadWrite): Promise<LeadRecord> {
  return db.customer.update({
    where: { id },
    data: { ...data, searchName: normalizeForSearch(data.fullName) },
    include: withRefs,
  });
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

/**
 * The re-care list's page: the contact-again day oldest first, leads without one last, then
 * the longest in the status; and how many of all matches are overdue (`overdue` is the fragment).
 */
export async function recareRows(
  db: Db,
  where: Prisma.CustomerWhereInput,
  overdue: Prisma.CustomerWhereInput,
  page: { skip: number; take: number },
): Promise<{ items: LeadRecord[]; total: number; overdueTotal: number }> {
  const [items, total, overdueTotal] = await Promise.all([
    db.customer.findMany({
      where,
      include: withRefs,
      orderBy: [
        { contactAgainOn: { sort: "asc", nulls: "last" } },
        { leadStatusChangedAt: "asc" },
        { leadCode: "asc" },
      ],
      ...page,
    }),
    db.customer.count({ where }),
    db.customer.count({ where: { AND: [where, overdue] } }),
  ]);
  return { items, total, overdueTotal };
}
